import { getNotificationService } from "./soketio.gateway.js";

export const NotificationInstance = {
  send: (options) => {
    const service = getNotificationService();
    return service.sendInvitation(options);
  },

  notifyUser: (userId, event, payload) => {
    const service = getNotificationService();
    return service.emitToUser(userId, event, payload);
  },

  // ✅ NEW: Payment Success Notification for seller + buyer
  sendPaymentReceivedNotification: async (operation) => {
    const service = getNotificationService();

    // IDs
    const sellerId = operation.user_dest._id?.toString();
    const buyerId = operation.user_src._id?.toString();

    // Content
    const bookTitle = operation.book_dest_id.Title;
    const amount = operation.totalPrice;

    // 📩 Notify Seller:
    await service.emitToUser(sellerId, "notification", {
      type: "message",
      message: `💰 Your book "${bookTitle}" has been paid for.`,
      operationId: operation._id.toString(),
      amount,
    });

    await service.emitToUser(buyerId, "notification", {
      type: "message",
      message: `🎉 Payment successful for "${bookTitle}".`,
      operationId: operation._id.toString(),
      amount,
    });

    console.log("📨 Payment success notifications sent via Socket.IO");
  },
};
