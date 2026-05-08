const User = require("../models/User"); // Added this import

/**
 * Saves a notification directly to the user's document in MongoDB
 */
const sendNotification = async (userId, title, message) => {
  try {
    const user = await User.findById(userId);
    if (user) {
      // Ensure the notifications array exists
      if (!user.notifications) {
        user.notifications = [];
      }

      user.notifications.push({
        title,
        message,
        date: new Date(),
        isRead: false,
      });

      await user.save();
      console.log(`Notification saved for user: ${userId}`);
    }
  } catch (error) {
    console.error("Notification failed:", error);
  }
};

// Exporting as an object so it matches your controller's 'require'
module.exports = { sendNotification };
