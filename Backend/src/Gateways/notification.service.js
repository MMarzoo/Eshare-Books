import { getUserSockets } from "../middelwares/socket.auth.middleware.js";

// notification.service.js
export class NotificationService {
  constructor(io) {
    this.io = io;
    this.pendingInvitations = new Map(); // Store pending invitations in memory
    // In production, you might want to use Redis or database for persistence
  }

  // Send invitation to user
  async sendInvitation(data) {
    const { fromUserId, toUserId, transactionType, message, metadata } = data;

    const invitationId = `inv_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    const invitation = {
      id: invitationId,
      fromUserId,
      toUserId,
      type: transactionType,
      message: message || `You have a new ${transactionType} invitation`,
      metadata: metadata || {},
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    // Store invitation (حتى لو المستخدم مش متصل)
    if (!this.pendingInvitations.has(toUserId)) {
      this.pendingInvitations.set(toUserId, []);
    }
    this.pendingInvitations.get(toUserId).push(invitation);

    // Check if recipient is connected
    const recipientSockets = getUserSockets(toUserId);

    // لو متصل، ابعتله الـ notification فورًا
    if (recipientSockets.length > 0) {
      recipientSockets.forEach((socketId) => {
        this.io.to(socketId).emit("new-invitation", invitation);
      });
      console.log(`✅ Invitation sent to online user: ${toUserId}`);
    } else {
      // لو مش متصل، الـ invitation محفوظة وهيستقبلها لما يدخل
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
    if (invitation) {
      invitation.status = "accepted";
      invitation.respondedAt = new Date().toISOString();
    }

    const senderId = invitation?.fromUserId;
    const senderSockets = senderId ? getUserSockets(senderId) : [];
    const recipientSockets = getUserSockets(userId);

    // ✅ تحديث الـ Operation في الـ Database
    if (operationId) {
      try {
        console.log("🔄 Updating operation:", operationId);

        const updatedOperation = await operationModel.findByIdAndUpdate(
          operationId,
          { status: "completed" },
          { new: true }
        );

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
      }
    }

    // Notify sender
    if (senderSockets.length > 0) {
      senderSockets.forEach((socketId) => {
        this.io.to(socketId).emit("invitation-accepted", {
          invitationId,
          acceptedBy: userId,
          invitation,
          operationId,
        });
      });
    }

    // Remove invitation
    if (invitation) {
      this.removeInvitation(invitationId, key);
    }

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

    // Remove from pending
    this.removeInvitation(invitationId, userId);

    return {
      invitationId,
      status: "refused",
      invitation,
    };
  }

  // Cancel invitation
  async cancelInvitation(invitationId, userId) {
    // Find invitation by ID and sender
    let invitation = null;
    let recipientId = null;

    for (const [toUserId, invitations] of this.pendingInvitations.entries()) {
      const foundInvitation = invitations.find(
        (inv) => inv.id === invitationId && inv.fromUserId === userId
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

    // Notify the recipient
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

    // Remove from pending
    this.removeInvitation(invitationId, recipientId);

    return {
      invitationId,
      status: "canceled",
      invitation,
    };
  }

  // Get pending invitations for user
  async getPendingInvitations(userId) {
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
    if (userInvitations) {
      const index = userInvitations.findIndex((inv) => inv.id === invitationId);
      if (index !== -1) {
        userInvitations.splice(index, 1);
        if (userInvitations.length === 0) {
          this.pendingInvitations.delete(userId);
        }
      }
    }
  }

  // Get all pending invitations (for admin purposes)
  getAllPendingInvitations() {
    const allInvitations = [];
    for (const [userId, invitations] of this.pendingInvitations.entries()) {
      allInvitations.push(...invitations.map((inv) => ({ ...inv })));
    }
    return allInvitations;
  }

  // Clean up expired invitations (call this periodically)
  cleanupExpiredInvitations(expiryTime = 24 * 60 * 60 * 1000) {
    // Default: 24 hours
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
