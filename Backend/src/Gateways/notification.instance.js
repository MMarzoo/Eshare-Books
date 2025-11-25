<<<<<<< HEAD
import { NotificationService } from "./notification.service.js";

let notificationServiceInstance = null;

// Initialize the NotificationService with socket.io instance
export const initNotificationService = (io) => {
  if (notificationServiceInstance) {
    console.warn("NotificationService already initialized");
    return notificationServiceInstance;
  }

  notificationServiceInstance = new NotificationService(io);
  console.log("NotificationService initialized successfully");

  // Setup cleanup job for expired invitations (every hour)
  setInterval(() => {
    notificationServiceInstance.cleanupExpiredInvitations();
    console.log("Cleaned up expired invitations");
  }, 60 * 60 * 1000); // Run every hour

  return notificationServiceInstance;
};

// Get the initialized NotificationService instance
export const getNotificationService = () => {
  if (!notificationServiceInstance) {
    throw new Error(
      "NotificationService not initialized. Call initNotificationService first."
    );
  }
  return notificationServiceInstance;
};
// Reset the NotificationService instance (useful for testing)
export const resetNotificationService = () => {
  notificationServiceInstance = null;
  console.log("NotificationService reset");
=======
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
>>>>>>> dev
};
