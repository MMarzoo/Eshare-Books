export class NotificationEvents {
  constructor(socket, notificationService) {
    this.socket = socket;
    this.notificationService = notificationService;
    this.userId = socket.data.userID;
  }

<<<<<<< HEAD
  // Initialize all notification event listeners
  initialize() {
    this.onSendInvitation();
    this.onAcceptInvitation();
    this.onRefuseInvitation();
    this.onGetPendingInvitations();
    this.onCancelInvitation();
  }

  // Handle sending invitations
  onSendInvitation() {
    this.socket.on("send-invitation", async (data) => {
      try {
        const { toUserId, invitationType, message, metadata } = data;

        console.log(`Invitation from ${this.userId} to ${toUserId}:`, data);

        const result = await this.notificationService.sendInvitation({
          fromUserId: this.userId,
          toUserId,
          invitationType,
          message,
          metadata: metadata || {},
        });

        // Acknowledge to sender
        this.socket.emit("invitation-sent", result);
      } catch (error) {
        console.error("Error sending invitation:", error);
        this.socket.emit("invitation-error", {
          error: error.message || "Failed to send invitation",
=======
    initialize() {
        this.onAcceptInvitation();
        this.onRefuseInvitation();
        this.onGetPendingInvitations();
        this.onCancelInvitation();
    }

    // ✅ Accept invitation with operationId
    onAcceptInvitation() {
        this.socket.on("accept-invitation", async (data) => {
            try {
                const { invitationId, userId, operationId } = data;

                console.log(`📥 accept-invitation:`, { invitationId, userId, operationId });

                const result = await this.notificationService.acceptInvitation(
                    invitationId,
                    userId || this.userId,
                    operationId
                );

                this.socket.emit("invitation-accepted", result);

            } catch (error) {
                console.error("❌ Error accepting invitation:", error);
                this.socket.emit("invitation-error", {
                    error: error.message || "Failed to accept invitation"
                });
            }
>>>>>>> dev
        });
      }
    });
  }

<<<<<<< HEAD
  // Handle accepting invitations
  onAcceptInvitation() {
    this.socket.on("accept-invitation", async (data) => {
      try {
        console.log("📥 Received accept-invitation payload:", data);
        const { invitationId, operationId } = data; // ← تأكد إنه بياخد operationId

        const result = await this.notificationService.acceptInvitation(
          invitationId,
          this.userId,
          operationId // ← بيمرره للـ service
        );

        this.socket.emit("invitation-accepted", result);
      } catch (error) {
        console.error("Error accepting invitation:", error);
        this.socket.emit("invitation-error", {
          error: error.message || "Failed to accept invitation",
=======
    // ✅ Refuse invitation with operationId
    onRefuseInvitation() {
        this.socket.on("refuse-invitation", async (data) => {
            try {
                const { invitationId, userId, reason, operationId } = data;

                console.log(`📥 refuse-invitation:`, { invitationId, userId, reason });

                const result = await this.notificationService.refuseInvitation(
                    invitationId,
                    userId || this.userId,
                    reason || "No reason provided",
                    operationId
                );

                this.socket.emit("invitation-refused", result);

            } catch (error) {
                console.error("❌ Error refusing invitation:", error);
                this.socket.emit("invitation-error", {
                    error: error.message || "Failed to refuse invitation"
                });
            }
>>>>>>> dev
        });
      }
    });
  }

<<<<<<< HEAD
  // Handle refusing invitations
  onRefuseInvitation() {
    this.socket.on("refuse-invitation", async (data) => {
      try {
        const { invitationId, reason } = data;

        console.log(`User ${this.userId} refusing invitation: ${invitationId}`);

        const result = await this.notificationService.refuseInvitation(
          invitationId,
          this.userId,
          reason
        );

        // Confirm to refuser
        this.socket.emit("invitation-refused", result);
      } catch (error) {
        console.error("Error refusing invitation:", error);
        this.socket.emit("invitation-error", {
          error: error.message || "Failed to refuse invitation",
=======
    // Cancel invitation
    onCancelInvitation() {
        this.socket.on("cancel-invitation", async (data) => {
            try {
                const { invitationId } = data;

                console.log(`📥 cancel-invitation:`, invitationId);

                const result = await this.notificationService.cancelInvitation(
                    invitationId,
                    this.userId
                );

                this.socket.emit("invitation-canceled", result);

            } catch (error) {
                console.error("❌ Error canceling invitation:", error);
                this.socket.emit("invitation-error", {
                    error: error.message || "Failed to cancel invitation"
                });
            }
>>>>>>> dev
        });
      }
    });
  }

<<<<<<< HEAD
  // Handle canceling invitations
  onCancelInvitation() {
    this.socket.on("cancel-invitation", async (data) => {
      try {
        const { invitationId } = data;

        console.log(
          `User ${this.userId} canceling invitation: ${invitationId}`
        );

        const result = await this.notificationService.cancelInvitation(
          invitationId,
          this.userId
        );

        // Confirm to canceler
        this.socket.emit("invitation-canceled", result);
      } catch (error) {
        console.error("Error canceling invitation:", error);
        this.socket.emit("invitation-error", {
          error: error.message || "Failed to cancel invitation",
=======
    // Get pending invitations
    onGetPendingInvitations() {
        this.socket.on("get-pending-invitations", async () => {
            try {
                const invitations = await this.notificationService.getPendingInvitations(this.userId);
                
                console.log(`📋 User ${this.userId} has ${invitations.length} pending invitations`);
                this.socket.emit("pending-invitations", { invitations });

            } catch (error) {
                console.error("❌ Error getting pending invitations:", error);
                this.socket.emit("invitation-error", {
                    error: "Failed to get pending invitations"
                });
            }
>>>>>>> dev
        });
      }
    });
  }

  // Handle getting pending invitations
  onGetPendingInvitations() {
    this.socket.on("get-pending-invitations", async () => {
      try {
        const invitations =
          await this.notificationService.getPendingInvitations(this.userId);

        this.socket.emit("pending-invitations", { invitations });
      } catch (error) {
        console.error("Error getting pending invitations:", error);
        this.socket.emit("invitation-error", {
          error: "Failed to get pending invitations",
        });
      }
    });
  }
}
