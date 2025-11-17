import operationModel from "../DB/models/operation.model.js";
import { getUserSockets } from "../middelwares/socket.auth.middleware.js";

export class NotificationService {
  constructor(io) {
    this.io = io;
    this.pendingInvitations = new Map(); // Store pending invitations in memory
  }

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

    const key = toUserId.toString();
    if (!this.pendingInvitations.has(key)) {
      this.pendingInvitations.set(key, []);
    }
    this.pendingInvitations.get(key).push(invitation);

    const recipientSockets = getUserSockets(toUserId);
    if (recipientSockets.length > 0) {
      recipientSockets.forEach((socketId) => {
        this.io.to(socketId).emit("new-invitation", invitation);
      });
      console.log(`✅ Invitation sent to online user: ${toUserId}`);
    } else {
      console.log(`📥 Invitation saved for offline user: ${toUserId}`);
    }

    return {
      invitationId,
      toUserId,
      status: "sent",
      invitation,
    };
  }

  async acceptInvitation(invitationId, userId, operationIdFromClient = null) {
    const key = userId.toString();
    const invitation = this.findInvitation(invitationId, key);

    if (!invitation && !operationIdFromClient) {
      throw new Error("Invitation not found and no operationId provided");
    }

    const operationId =
      invitation?.metadata?.operationId || operationIdFromClient;

    if (invitation) {
      invitation.status = "accepted";
      invitation.respondedAt = new Date().toISOString();
    }

    const senderId = invitation?.fromUserId;
    const senderSockets = senderId ? getUserSockets(senderId) : [];
    const recipientSockets = getUserSockets(userId); // المستخدم اللي قبل الدعوة

    if (operationId) {
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
        [...senderSockets, ...recipientSockets].forEach((socketId) => {
          this.io.to(socketId).emit("operation-updated", updatedOperation);
        });
      }
    }

    if (senderSockets.length > 0) {
      senderSockets.forEach((socketId) => {
        this.io.to(socketId).emit("invitation-accepted", {
          invitationId,
          acceptedBy: userId,
          invitation,
        });
      });
    }

    if (invitation) {
      this.removeInvitation(invitationId, key);
    }

    return {
      invitationId,
      status: "accepted",
      invitation,
    };
  }

  async refuseInvitation(invitationId, userId, reason) {
    const key = userId.toString();
    const invitation = this.findInvitation(invitationId, key);

    if (!invitation) {
      throw new Error("Invitation not found");
    }

    invitation.status = "refused";
    invitation.refusalReason = reason;
    invitation.respondedAt = new Date().toISOString();

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

    this.removeInvitation(invitationId, key);

    return {
      invitationId,
      status: "refused",
      invitation,
    };
  }

  async cancelInvitation(invitationId, userId) {
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

    this.removeInvitation(invitationId, recipientId.toString());

    return {
      invitationId,
      status: "canceled",
      invitation,
    };
  }

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
}
