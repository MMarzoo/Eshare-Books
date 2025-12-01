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

  // ✅ NEW: Send payment received notification to both seller and buyer
  sendPaymentReceivedNotification: (sellerId, buyerId, operation) => {
    const service = getNotificationService();
    return service.sendPaymentReceivedNotification(
      sellerId,
      buyerId,
      operation
    );
  },

  // ✅ NEW: Send payment success notification (backwards compatibility)
  sendPaymentSuccessNotification: (userId, operation) => {
    const service = getNotificationService();
    return service.sendPaymentSuccessNotification(userId, operation);
  },
};
