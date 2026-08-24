const User = require("../models/User");

// Ƙoƙarin kiran Socket instance idan an riga an saita shi a server
let getIO;
try {
  const socketModule = require("../config/socket");
  getIO = socketModule.getIO || socketModule.emitEvent;
} catch (e) {
  getIO = null;
}

/**
 * Saves and delivers notifications in real-time
 * @param {String} userId - User identifier
 * @param {String} title - Notification title (e.g. "Wallet Credited", "Refund Processed")
 * @param {String} message - Detailed notification body
 * @param {String} category - Notification category ('CREDIT', 'ACCOUNT', 'REFUND', 'BROADCAST', 'SYSTEM')
 * @param {Object} metadata - Optional transaction or reference payload
 */
const sendNotification = async (
  userId,
  title,
  message,
  category = "SYSTEM",
  metadata = {}
) => {
  try {
    if (!userId) {
      console.warn("⚠️ Notification Warning: No userId provided.");
      return null;
    }

    const user = await User.findById(userId);
    if (!user) {
      console.warn(`⚠️ Notification Warning: User not found with ID: ${userId}`);
      return null;
    }

    if (!user.notifications) {
      user.notifications = [];
    }

    const newNotification = {
      title: String(title || "New Notification").trim(),
      message: String(message || "").trim(),
      category: String(category || "SYSTEM").toUpperCase().trim(),
      metadata: metadata || {},
      isRead: false,
      date: new Date(),
      createdAt: new Date(),
    };

    // Saka sabuwar sanarwa a farkon jeri (Newest First)
    user.notifications.unshift(newNotification);

    // Kula da girmar array ta yadda ba zai wuce sanarwa 100 ba
    if (user.notifications.length > 100) {
      user.notifications = user.notifications.slice(0, 100);
    }

    await user.save();
    console.log(`⚡ [NOTIFICATION DISPATCHED] -> User: ${userId} | Category: ${category} | Title: "${title}"`);

    // Tura Real-time Socket Event zuwa wayar user idan yana online
    try {
      if (typeof getIO === "function") {
        getIO(`user-notification-${userId}`, newNotification);
        getIO("notification", { userId, ...newNotification });
      }
    } catch (sockErr) {
      // Socket offline fallback
    }

    return newNotification;
  } catch (error) {
    console.error("❌ Notification saving failed:", error.message);
    return null;
  }
};

/**
 * Broadcasts an announcement or alert to all registered users simultaneously
 * @param {String} title - Announcement title
 * @param {String} message - Announcement message
 */
const sendBroadcastNotification = async (title, message) => {
  try {
    const broadcastPayload = {
      title: String(title || "System Announcement").trim(),
      message: String(message || "").trim(),
      category: "BROADCAST",
      isRead: false,
      date: new Date(),
      createdAt: new Date(),
    };

    // Sabunta dukkan documents na User a lokaci guda
    await User.updateMany(
      {},
      {
        $push: {
          notifications: {
            $each: [broadcastPayload],
            $position: 0,
            $slice: 100,
          },
        },
      }
    );

    console.log(`📢 [GLOBAL BROADCAST SENT] -> Title: "${title}"`);

    try {
      if (typeof getIO === "function") {
        getIO("global-broadcast", broadcastPayload);
      }
    } catch (sockErr) {}

    return true;
  } catch (error) {
    console.error("❌ Broadcast notification failed:", error.message);
    return false;
  }
};

module.exports = {
  sendNotification,
  sendBroadcastNotification,
};