export class NotificationEvents {
  constructor(socket, notificationService) {
    this.socket = socket;
    this.notificationService = notificationService;
    this.userId = socket.data.userID;
  }

  initialize() {
    this.onAcceptInvitation();
    this.onRefuseInvitation();
    this.onGetPendingInvitations();
    this.onCancelInvitation();
    this.onBookDeleted();
    this.onOperationCancelled();
  }

  // ✅ Accept invitation with operationId
  onAcceptInvitation() {
    this.socket.on('accept-invitation', async (data) => {
      try {
        const { invitationId, userId, operationId } = data;

        console.log(`📥 accept-invitation:`, { invitationId, userId, operationId });

        const result = await this.notificationService.acceptInvitation(
          invitationId,
          userId || this.userId,
          operationId
        );

        this.socket.emit('invitation-accepted', result);
      } catch (error) {
        console.error('❌ Error accepting invitation:', error);
        this.socket.emit('invitation-error', {
          error: error.message || 'Failed to accept invitation',
        });
      }
    });
  }

  // ✅ Refuse invitation with operationId
  onRefuseInvitation() {
    this.socket.on('refuse-invitation', async (data) => {
      try {
        const { invitationId, userId, reason, operationId } = data;

        console.log(`📥 refuse-invitation:`, { invitationId, userId, reason });

        const result = await this.notificationService.refuseInvitation(
          invitationId,
          userId || this.userId,
          reason || 'No reason provided',
          operationId
        );

        this.socket.emit('invitation-refused', result);
      } catch (error) {
        console.error('❌ Error refusing invitation:', error);
        this.socket.emit('invitation-error', {
          error: error.message || 'Failed to refuse invitation',
        });
      }
    });
  }

  // Cancel invitation
  onCancelInvitation() {
    this.socket.on('cancel-invitation', async (data) => {
      try {
        const { invitationId } = data;

        console.log(`📥 cancel-invitation:`, invitationId);

        const result = await this.notificationService.cancelInvitation(invitationId, this.userId);

        this.socket.emit('invitation-canceled', result);
      } catch (error) {
        console.error('❌ Error canceling invitation:', error);
        this.socket.emit('invitation-error', {
          error: error.message || 'Failed to cancel invitation',
        });
      }
    });
  }

  // Get pending invitations
  onGetPendingInvitations() {
    this.socket.on('get-pending-invitations', async () => {
      try {
        const invitations = await this.notificationService.getPendingInvitations(this.userId);

        console.log(`📋 User ${this.userId} has ${invitations.length} pending invitations`);
        this.socket.emit('pending-invitations', { invitations });
      } catch (error) {
        console.error('❌ Error getting pending invitations:', error);
        this.socket.emit('invitation-error', {
          error: 'Failed to get pending invitations',
        });
      }
    });
  }

  // ✅ استقبال إشعار حذف الكتاب (النسخة المعدلة بدون معلومات الأدمن)
  onBookDeleted() {
    this.socket.on('book-deleted', async (data) => {
      try {
        console.log(`📘 Book deleted notification for user ${this.userId}:`, data);

        // حفظ الإشعار في قاعدة البيانات
        await this.notificationService.saveNotification({
          userId: this.userId,
          type: 'book_deletion',
          title: 'Book Removed',
          body: data.message,
          data: {
            bookId: data.bookId,
            bookTitle: data.bookTitle,
            reason: data.reason,
            note: data.note || 'Book removed due to policy violation',
            deletedAt: data.deletedAt,
            // لا نُخزن معلومات الأدمن هنا
          },
        });

        // إرسال تأكيد للعميل
        this.socket.emit('book-deleted-received', {
          bookId: data.bookId,
          bookTitle: data.bookTitle,
          timestamp: new Date(),
        });
      } catch (error) {
        console.error('❌ Error processing book deletion notification:', error);
      }
    });
  }

  // ✅ استقبال إشعار إلغاء العملية (النسخة المعدلة بدون معلومات الأدمن)
  onOperationCancelled() {
    this.socket.on('operation-cancelled', async (data) => {
      try {
        console.log(`🔄 Operation cancelled notification for user ${this.userId}:`, data);

        // حفظ الإشعار في قاعدة البيانات
        await this.notificationService.saveNotification({
          userId: this.userId,
          type: 'operation_cancellation',
          title: 'Operation Cancelled',
          body: data.message,
          data: {
            bookId: data.bookId,
            bookTitle: data.bookTitle,
            operationId: data.operationId,
            operationType: data.operationType,
            reason: data.reason,
            note: data.note || 'Operation cancelled due to book removal',
            cancelledAt: data.cancelledAt,
            // لا نُخزن معلومات الأدمن هنا
          },
        });

        // إرسال تأكيد للعميل
        this.socket.emit('operation-cancelled-received', {
          operationId: data.operationId,
          bookTitle: data.bookTitle,
          timestamp: new Date(),
        });
      } catch (error) {
        console.error('❌ Error processing operation cancellation notification:', error);
      }
    });
  }
}
