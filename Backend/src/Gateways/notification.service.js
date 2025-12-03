import { getUserSockets } from '../middelwares/socket.auth.middleware.js';
import operationModel from '../DB/models/operation.model.js';

export class NotificationService {
  constructor(io) {
    this.io = io;
    this.pendingInvitations = new Map();
  }

  // SEND INVITATION

  async sendInvitation(data) {
    const { fromUserId, toUserId, transactionType, message, metadata } = data;

    const invitationId = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const invitation = {
      id: invitationId,
      fromUserId: fromUserId.toString(),
      toUserId: toUserId.toString(),
      type: transactionType,
      message: message || `You have a new ${transactionType} invitation`,
      metadata: metadata || {},
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const key = toUserId.toString();
    if (!this.pendingInvitations.has(key)) {
      this.pendingInvitations.set(key, []);
    }
    this.pendingInvitations.get(key).push(invitation);

    const recipientSockets = getUserSockets(toUserId);
    if (recipientSockets.length > 0) {
      recipientSockets.forEach((socketId) => {
        this.io.to(socketId).emit('new-invitation', invitation);
      });
    }

    return {
      invitationId,
      toUserId,
      status: 'sent',
      invitation,
    };
  }

  // ACCEPT INVITATION
  async acceptInvitation(invitationId, userId, operationId = null) {
    const key = userId.toString();
    const invitation = this.findInvitation(invitationId, key);

    const finalOperationId = operationId || invitation?.metadata?.operationId;

    if (!invitation && !finalOperationId) {
      throw new Error('Invitation not found and no operationId provided');
    }

    if (invitation) {
      invitation.status = 'accepted';
      invitation.respondedAt = new Date().toISOString();
    }

    const senderId = invitation?.fromUserId;
    const senderSockets = senderId ? getUserSockets(senderId) : [];
    const recipientSockets = getUserSockets(userId);

    // Update Operation => completed
    let updatedOperation = null;

    if (finalOperationId) {
      updatedOperation = await operationModel.findByIdAndUpdate(
        finalOperationId,
        { status: 'completed' },
        { new: true }
      );

      // check for transactionType for toDonate
      if (updatedOperation.operationType !== 'donate') {
        // Emit payment-required event
        senderSockets.forEach((socketId) => {
          this.io.to(socketId).emit('payment-required', {
            operationId: updatedOperation._id,
            totalPrice: updatedOperation.totalPrice,
            paymentStatus: updatedOperation.paymentStatus,
            status: updatedOperation.status,
            message: 'Payment is required to proceed',
          });
        });

        // Send Payment Notification
        const buyerSockets = getUserSockets(updatedOperation.user_src);
        const paymentNotification = {
          type: 'payment',
          message: 'Your book request was accepted. Please proceed with payment.',
          operationId: updatedOperation._id.toString(),
          totalPrice: updatedOperation.totalPrice,
          createdAt: new Date().toISOString(),
        };

        buyerSockets.forEach((socketId) => {
          this.io.to(socketId).emit('new-notification', paymentNotification);
        });
      }
    }

    // Notify sender about acceptance
    if (senderSockets.length > 0) {
      senderSockets.forEach((socketId) => {
        this.io.to(socketId).emit('invitation-accepted', {
          invitationId,
          acceptedBy: userId,
          invitation,
          operationId: finalOperationId,
        });
      });
    }

    if (invitation) {
      this.removeInvitation(invitationId, key);
    }

    return {
      invitationId,
      status: 'accepted',
      invitation,
      operationId: finalOperationId,
      updatedOperation,
    };
  }

  // REFUSE INVITATION

  async refuseInvitation(invitationId, userId, reason, operationId = null) {
    const key = userId.toString();
    const invitation = this.findInvitation(invitationId, key);

    const finalOperationId = operationId || invitation?.metadata?.operationId;

    if (!invitation && !finalOperationId) {
      throw new Error('Invitation not found');
    }

    if (invitation) {
      invitation.status = 'refused';
      invitation.refusalReason = reason;
      invitation.respondedAt = new Date().toISOString();
    }

    const senderId = invitation?.fromUserId;
    const senderSockets = senderId ? getUserSockets(senderId) : [];
    const recipientSockets = getUserSockets(userId);

    // Update DB → rejected

    if (finalOperationId) {
      const updatedOperation = await operationModel.findByIdAndUpdate(
        finalOperationId,
        { status: 'rejected' },
        { new: true }
      );

      const allSockets = [...senderSockets, ...recipientSockets];
      allSockets.forEach((socketId) => {
        this.io.to(socketId).emit('operation-updated', updatedOperation);
      });
    }

    if (senderSockets.length > 0) {
      senderSockets.forEach((socketId) => {
        this.io.to(socketId).emit('invitation-refused', {
          invitationId,
          refusedBy: userId,
          reason,
          invitation,
        });
      });
    }

    if (invitation) {
      this.removeInvitation(invitationId, key);
    }

    return {
      invitationId,
      status: 'refused',
      invitation,
    };
  }

  // CANCEL INVITATION
  async cancelInvitation(invitationId, userId) {
    let invitation = null;
    let recipientId = null;

    for (const [toUserId, invitations] of this.pendingInvitations.entries()) {
      const found = invitations.find(
        (inv) => inv.id === invitationId && inv.fromUserId === userId.toString()
      );
      if (found) {
        invitation = found;
        recipientId = toUserId;
        break;
      }
    }

    if (!invitation) {
      throw new Error('Invitation not found or you are not the sender');
    }

    invitation.status = 'canceled';
    invitation.canceledAt = new Date().toISOString();

    const recipientSockets = getUserSockets(recipientId);
    if (recipientSockets.length > 0) {
      recipientSockets.forEach((socketId) => {
        this.io.to(socketId).emit('invitation-canceled', {
          invitationId,
          canceledBy: userId,
          invitation,
        });
      });
    }

    this.removeInvitation(invitationId, recipientId);

    return {
      invitationId,
      status: 'canceled',
      invitation,
    };
  }

  // SEND PAYMENT SUCCESS NOTIFICATION
  async sendPaymentSuccessNotification(userId, operation) {
    const recipientSockets = getUserSockets(userId);

    const successNotification = {
      type: 'payment-success',
      message: 'Your payment was completed successfully.',
      operationID: operation._id.toString(),
      amount: operation.totalPrice,
      createdAt: new Date().toISOString(),
    };

    recipientSockets.forEach((socketId) => {
      this.io.to(socketId).emit('new-notification', successNotification);
    });
  }

  // HELPERS
  async getPendingInvitations(userId) {
    const key = userId.toString();
    return this.pendingInvitations.get(key) || [];
  }

  findInvitation(invitationId, userId) {
    const key = userId.toString();
    const userInvitations = this.pendingInvitations.get(key) || [];
    return userInvitations.find((inv) => inv.id === invitationId);
  }

  removeInvitation(invitationId, userId) {
    const key = userId.toString();
    const userInvitations = this.pendingInvitations.get(key);
    if (userInvitations) {
      const index = userInvitations.findIndex((inv) => inv.id === invitationId);
      if (index !== -1) {
        userInvitations.splice(index, 1);
        if (userInvitations.length === 0) {
          this.pendingInvitations.delete(key);
        }
      }
    }
  }

  getAllPendingInvitations() {
    const allInvitations = [];
    for (const [userId, invitations] of this.pendingInvitations.entries()) {
      allInvitations.push(...invitations.map((inv) => ({ ...inv })));
    }
    return allInvitations;
  }

  cleanupExpiredInvitations(expiryTime = 24 * 60 * 60 * 1000) {
    const now = new Date();
    for (const [userId, invitations] of this.pendingInvitations.entries()) {
      const validInvitations = invitations.filter((invitation) => {
        const created = new Date(invitation.createdAt);
        return now - created < expiryTime;
      });

      if (validInvitations.length === 0) {
        this.pendingInvitations.delete(userId);
      } else {
        this.pendingInvitations.set(userId, validInvitations);
      }
    }
  }

  // ✅ دالة لحفظ الإشعارات (مطلوبة في notification.events.js)
  async saveNotification(notificationData) {
    try {
      console.log(
        `💾 Saving notification for user ${notificationData.userId}: ${notificationData.title}`
      );

      // هنا يمكنك حفظ الإشعار في قاعدة بيانات إذا كنت تريد
      // const savedNotification = await notificationModel.create(notificationData);

      return { success: true, data: notificationData };
    } catch (error) {
      console.error('❌ Error saving notification:', error);
      return { success: false, error: error.message };
    }
  }

  emitToUser(userId, event, data) {
    const recipientSockets = getUserSockets(userId);
    if (recipientSockets.length > 0) {
      recipientSockets.forEach((socketId) => {
        this.io.to(socketId).emit(event, data);
      });
      return { success: true, sentTo: recipientSockets.length };
    }
    return { success: false, reason: 'User not connected' };
  }

  sendBookRestoredNotification(userId, bookDetails) {
    const notification = {
      ...bookDetails,
      timestamp: new Date().toISOString(),
    };

    return this.emitToUser(userId, 'book-restored', notification);
  }

  async sendBookModerationNotification(userId, bookDetails, isApproved) {
    const notificationType = isApproved ? 'book_approved' : 'book_rejected';
    const message = isApproved
      ? `Your book "${bookDetails.title}" has been approved and is now available on the platform.`
      : `Your book "${bookDetails.title}" has been rejected and will be reviewed. It can be restored if it doesn't violate our policies.`;
    const notification = {
      type: notificationType,
      title: isApproved ? 'Book Approved' : 'Book Rejected',
      message,
      data: {
        bookId: bookDetails.id,
        bookTitle: bookDetails.title,
        updatedAt: new Date().toISOString(),
        isApproved,
      },
      createdAt: new Date().toISOString(),
    };

    return this.emitToUser(userId, notificationType, notification);
  }

  /**
   * ✅ إرسال إشعارات اقتراح الفئة (مقبول/مرفوض)
   * @param {string} userId - معرف المستخدم
   * @param {object} notificationData - بيانات الإشعار
   */
  async sendCategorySuggestionNotification(userId, notificationData) {
    try {
      const recipientSockets = getUserSockets(userId);

      if (recipientSockets.length === 0) {
        console.log(
          `ℹ️ User ${userId} is not connected, notification will be delivered when online`
        );
        return { success: false, reason: 'User not connected' };
      }

      const notification = {
        ...notificationData,
        timestamp: new Date().toISOString(),
      };

      // إرسال الإشعار عبر Socket
      recipientSockets.forEach((socketId) => {
        this.io.to(socketId).emit('category-suggestion-updated', notification);
      });

      console.log(`✅ Category suggestion notification sent to user ${userId}`);
      return {
        success: true,
        sentTo: recipientSockets.length,
        notification,
      };
    } catch (error) {
      console.error('❌ Error sending category suggestion notification:', error);
      return { success: false, error: error.message };
    }
  }
}
