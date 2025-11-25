import { getUserSockets } from "../middelwares/socket.auth.middleware.js";
import operationModel from "../DB/models/operation.model.js";

export class NotificationService {
  constructor(io) {
    this.io = io;
<<<<<<< HEAD
    this.pendingInvitations = new Map(); // Store pending invitations in memory
    // In production, you might want to use Redis or database for persistence
=======
    this.pendingInvitations = new Map();
>>>>>>> dev
  }

  // Send invitation to user
  async sendInvitation(data) {
    const { fromUserId, toUserId, transactionType, message, metadata } = data;

    const invitationId = `inv_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    const invitation = {
      id: invitationId,
<<<<<<< HEAD
      fromUserId,
      toUserId,
=======
      fromUserId: fromUserId.toString(),
      toUserId: toUserId.toString(),
>>>>>>> dev
      type: transactionType,
      message: message || `You have a new ${transactionType} invitation`,
      metadata: metadata || {},
      status: "pending",
      createdAt: new Date().toISOString(),
    };

<<<<<<< HEAD
    // Store invitation (حتى لو المستخدم مش متصل)
    if (!this.pendingInvitations.has(toUserId)) {
      this.pendingInvitations.set(toUserId, []);
    }
    this.pendingInvitations.get(toUserId).push(invitation);

    // Check if recipient is connected
    const recipientSockets = getUserSockets(toUserId);

    // لو متصل، ابعتله الـ notification فورًا
=======
    // ✅ Store invitation (حتى لو User offline)
    const key = toUserId.toString();
    if (!this.pendingInvitations.has(key)) {
      this.pendingInvitations.set(key, []);
    }
    this.pendingInvitations.get(key).push(invitation);

    console.log(`💾 Invitation saved for user ${key}, ID: ${invitationId}`);

    // ✅ Send if online
    const recipientSockets = getUserSockets(toUserId);
>>>>>>> dev
    if (recipientSockets.length > 0) {
      recipientSockets.forEach((socketId) => {
        this.io.to(socketId).emit("new-invitation", invitation);
      });
      console.log(`✅ Invitation sent to online user: ${toUserId}`);
    } else {
<<<<<<< HEAD
      // لو مش متصل، الـ invitation محفوظة وهيستقبلها لما يدخل
=======
>>>>>>> dev
      console.log(`📥 Invitation saved for offline user: ${toUserId}`);
    }

    return {
      invitationId,
      toUserId,
      status: "sent",
      invitation,
    };
  }

  // Accept invitation
<<<<<<< HEAD
  async acceptInvitation(invitationId, userId, operationIdFromClient = null) {
    const key = userId.toString();

    // ✅ Debug: اطبع كل الـ invitations
    console.log("🔍 Looking for invitation:", invitationId);
    console.log("🔍 For user:", key);
    console.log(
      "🔍 All pending invitations:",
      Array.from(this.pendingInvitations.keys())
    );
    console.log("🔍 User invitations:", this.pendingInvitations.get(key));

    const invitation = this.findInvitation(invitationId, key);

    // ✅ جلب الـ operationId من أي مصدر متاح
    const operationId =
      operationIdFromClient || invitation?.metadata?.operationId;

    console.log("🔍 Found invitation:", invitation);
    console.log("🔍 Operation ID:", operationId);

    if (!invitation && !operationId) {
      throw new Error("Invitation not found and no operationId provided");
    }

    // Update invitation status if found
=======
  async acceptInvitation(invitationId, userId, operationId = null) {
    const key = userId.toString();
    const invitation = this.findInvitation(invitationId, key);

    console.log("🔍 acceptInvitation:", {
      invitationId,
      userId,
      operationId,
      found: !!invitation,
    });

    // ✅ Get operationId from invitation or parameter
    const finalOperationId = operationId || invitation?.metadata?.operationId;

    if (!invitation && !finalOperationId) {
      throw new Error("Invitation not found and no operationId provided");
    }

    // Update invitation status
>>>>>>> dev
    if (invitation) {
      invitation.status = "accepted";
      invitation.respondedAt = new Date().toISOString();
    }

    const senderId = invitation?.fromUserId;
    const senderSockets = senderId ? getUserSockets(senderId) : [];
    const recipientSockets = getUserSockets(userId);

<<<<<<< HEAD
    // ✅ تحديث الـ Operation في الـ Database
    if (operationId) {
      try {
        console.log("🔄 Updating operation:", operationId);

        const updatedOperation = await operationModel.findByIdAndUpdate(
          operationId,
=======
    // ✅ Update Operation in Database
    if (finalOperationId) {
      try {
        console.log(`🔄 Updating operation ${finalOperationId} to completed`);

        const updatedOperation = await operationModel.findByIdAndUpdate(
          finalOperationId,
>>>>>>> dev
          { status: "completed" },
          { new: true }
        );

<<<<<<< HEAD
        if (!updatedOperation) {
          console.warn(`⚠️ Operation not found for ID: ${operationId}`);
        } else {
          console.log(`✅ Operation ${operationId} marked as completed`);

          // ✅ إرسال التحديث للطرفين
          const allSockets = [...senderSockets, ...recipientSockets];
          console.log("📡 Sending update to sockets:", allSockets);

          allSockets.forEach((socketId) => {
            this.io.to(socketId).emit("operation-updated", updatedOperation);
          });
        }
      } catch (error) {
        console.error(`❌ Error updating operation ${operationId}:`, error);
=======
        if (updatedOperation) {
          console.log(`✅ Operation ${finalOperationId} marked as completed`);

          // ✅ Send operation-updated event to both parties
          const allSockets = [...senderSockets, ...recipientSockets];
          allSockets.forEach((socketId) => {
            this.io.to(socketId).emit("operation-updated", updatedOperation);
          });
          console.log(
            `📡 Sent operation-updated to ${allSockets.length} sockets`
          );
        } else {
          console.warn(`⚠️ Operation not found: ${finalOperationId}`);
        }
      } catch (error) {
        console.error(`❌ Error updating operation:`, error);
>>>>>>> dev
      }
    }

    // Notify sender
    if (senderSockets.length > 0) {
      senderSockets.forEach((socketId) => {
        this.io.to(socketId).emit("invitation-accepted", {
          invitationId,
          acceptedBy: userId,
          invitation,
<<<<<<< HEAD
          operationId,
=======
          operationId: finalOperationId,
>>>>>>> dev
        });
      });
    }

    // Remove invitation
    if (invitation) {
      this.removeInvitation(invitationId, key);
    }
<<<<<<< HEAD

    return {
      invitationId,
      status: "accepted",
      invitation,
      operationId,
    };
  }

  // Refuse invitation
  async refuseInvitation(invitationId, userId, reason) {
    const invitation = this.findInvitation(invitationId, userId);

    if (!invitation) {
      throw new Error("Invitation not found");
    }

    invitation.status = "refused";
    invitation.refusalReason = reason;
    invitation.respondedAt = new Date().toISOString();

    // Notify the sender
    const senderSockets = getUserSockets(invitation.fromUserId);
=======

    return {
      invitationId,
      status: "accepted",
      invitation,
      operationId: finalOperationId,
    };
  }

  // Refuse invitation
  async refuseInvitation(invitationId, userId, reason, operationId = null) {
    const key = userId.toString();
    const invitation = this.findInvitation(invitationId, key);

    console.log("🔍 refuseInvitation:", {
      invitationId,
      userId,
      found: !!invitation,
    });

    const finalOperationId = operationId || invitation?.metadata?.operationId;

    if (!invitation && !finalOperationId) {
      throw new Error("Invitation not found");
    }

    if (invitation) {
      invitation.status = "refused";
      invitation.refusalReason = reason;
      invitation.respondedAt = new Date().toISOString();
    }

    const senderId = invitation?.fromUserId;
    const senderSockets = senderId ? getUserSockets(senderId) : [];
    const recipientSockets = getUserSockets(userId);

    // ✅ Update Operation to rejected
    if (finalOperationId) {
      try {
        console.log(`🔄 Updating operation ${finalOperationId} to rejected`);

        const updatedOperation = await operationModel.findByIdAndUpdate(
          finalOperationId,
          { status: "rejected" },
          { new: true }
        );

        if (updatedOperation) {
          console.log(`✅ Operation ${finalOperationId} marked as rejected`);

          const allSockets = [...senderSockets, ...recipientSockets];
          allSockets.forEach((socketId) => {
            this.io.to(socketId).emit("operation-updated", updatedOperation);
          });
        }
      } catch (error) {
        console.error(`❌ Error updating operation:`, error);
      }
    }

    // Notify sender
>>>>>>> dev
    if (senderSockets.length > 0) {
      senderSockets.forEach((socketId) => {
        this.io.to(socketId).emit("invitation-refused", {
          invitationId,
          refusedBy: userId,
          reason,
          invitation,
        });
      });
    }

<<<<<<< HEAD
    // Remove from pending
    this.removeInvitation(invitationId, userId);
=======
    // Remove invitation
    if (invitation) {
      this.removeInvitation(invitationId, key);
    }
>>>>>>> dev

    return {
      invitationId,
      status: "refused",
      invitation,
    };
  }

  // Cancel invitation
  async cancelInvitation(invitationId, userId) {
<<<<<<< HEAD
    // Find invitation by ID and sender
=======
>>>>>>> dev
    let invitation = null;
    let recipientId = null;

    for (const [toUserId, invitations] of this.pendingInvitations.entries()) {
      const foundInvitation = invitations.find(
<<<<<<< HEAD
        (inv) => inv.id === invitationId && inv.fromUserId === userId
=======
        (inv) => inv.id === invitationId && inv.fromUserId === userId.toString()
>>>>>>> dev
      );
      if (foundInvitation) {
        invitation = foundInvitation;
        recipientId = toUserId;
        break;
      }
    }

    if (!invitation) {
      throw new Error("Invitation not found or you are not the sender");
    }

    invitation.status = "canceled";
    invitation.canceledAt = new Date().toISOString();

<<<<<<< HEAD
    // Notify the recipient
=======
>>>>>>> dev
    const recipientSockets = getUserSockets(recipientId);
    if (recipientSockets.length > 0) {
      recipientSockets.forEach((socketId) => {
        this.io.to(socketId).emit("invitation-canceled", {
          invitationId,
          canceledBy: userId,
          invitation,
        });
      });
    }

<<<<<<< HEAD
    // Remove from pending
=======
>>>>>>> dev
    this.removeInvitation(invitationId, recipientId);

    return {
      invitationId,
      status: "canceled",
      invitation,
    };
  }

  // Get pending invitations for user
  async getPendingInvitations(userId) {
<<<<<<< HEAD
    return this.pendingInvitations.get(userId) || [];
  }

  // Helper method to find invitation
  findInvitation(invitationId, userId) {
    const userInvitations = this.pendingInvitations.get(userId) || [];
    return userInvitations.find((inv) => inv.id === invitationId);
  }

  // Helper method to remove invitation
  removeInvitation(invitationId, userId) {
    const userInvitations = this.pendingInvitations.get(userId);
=======
    const key = userId.toString();
    return this.pendingInvitations.get(key) || [];
  }

  // Helper: find invitation
  findInvitation(invitationId, userId) {
    const key = userId.toString();
    const userInvitations = this.pendingInvitations.get(key) || [];
    return userInvitations.find((inv) => inv.id === invitationId);
  }

  // Helper: remove invitation
  removeInvitation(invitationId, userId) {
    const key = userId.toString();
    const userInvitations = this.pendingInvitations.get(key);
>>>>>>> dev
    if (userInvitations) {
      const index = userInvitations.findIndex((inv) => inv.id === invitationId);
      if (index !== -1) {
        userInvitations.splice(index, 1);
        if (userInvitations.length === 0) {
<<<<<<< HEAD
          this.pendingInvitations.delete(userId);
=======
          this.pendingInvitations.delete(key);
>>>>>>> dev
        }
      }
    }
  }

<<<<<<< HEAD
  // Get all pending invitations (for admin purposes)
=======
  // Get all pending invitations (admin)
>>>>>>> dev
  getAllPendingInvitations() {
    const allInvitations = [];
    for (const [userId, invitations] of this.pendingInvitations.entries()) {
      allInvitations.push(...invitations.map((inv) => ({ ...inv })));
    }
    return allInvitations;
  }

<<<<<<< HEAD
  // Clean up expired invitations (call this periodically)
  cleanupExpiredInvitations(expiryTime = 24 * 60 * 60 * 1000) {
    // Default: 24 hours
=======
  // Cleanup expired invitations
  cleanupExpiredInvitations(expiryTime = 24 * 60 * 60 * 1000) {
>>>>>>> dev
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
}
