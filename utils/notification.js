const User = require("../models/User");

/**
 * Saves a notification directly to the user's document in MongoDB
 * @param {String} userId - ID na mai amfani
 * @param {String} title - Taken sanarwar (e.g., "Data Purchase Successful" ko "Refund Issued")
 * @param {String} message - Cikakken bayanin sanarwar
 */
const sendNotification = async (userId, title, message) => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      console.warn(`Notification warning: User not found with ID: ${userId}`);
      return;
    }

    // Ensure the notifications array exists
    if (!user.notifications) {
      user.notifications = [];
    }

    // Tura sabuwar sanarwa zuwa gaban array din (ko karshe, dangane da yadda kake so ta fito)
    user.notifications.push({
      title,
      message,
      date: new Date(),
      isRead: false,
    });

    await user.save();
    console.log(`Notification successfully saved for user: ${userId}`);
  } catch (error) {
    console.error("Notification saving failed:", error);
  }
};

// Exporting as an object so it matches your controllers' 'require'
module.exports = { sendNotification };