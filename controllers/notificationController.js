const Notification = require("../models/Notification");
const User = require("../models/User");
const Activity = require("../models/Activity");

// Helper don kiran Socket instance idan yana aiki a server
let getIO;
try {
  const socketModule = require("../config/socket");
  getIO = socketModule.getIO || socketModule.emitEvent;
} catch (e) {
  getIO = null;
}

/**
 * @desc    Get logged in user's notifications (Matches Frontend: NotificationScreen.js)
 * @route   GET /api/v1/notifications
 * @route   GET /api/v1/notifications/my-notifications
 * @access  Private (User)
 */
exports.getMyNotifications = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("notifications role").lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "User account not found.",
      });
    }

    // 1. Dauko personal notifications daga User document
    let userDirectNotifications = user.notifications || [];

    // 2. Dauko Active Broadcasts daga Notification Model
    const broadcastQuery = {
      isActive: true,
      $or: [
        { recipient: userId },
        { target: "all" },
        { target: user.role || "user" },
        { recipient: null },
      ],
    };

    const globalBroadcasts = await Notification.find(broadcastQuery)
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    // 3. Hadawa da tsara su (Newest First)
    const formattedBroadcasts = globalBroadcasts.map((b) => ({
      _id: b._id,
      id: b._id,
      title: b.title,
      message: b.message,
      category: b.category || b.type || "BROADCAST",
      type: b.type || "info",
      actionRoute: b.actionRoute || null,
      isRead: Array.isArray(b.readBy)
        ? b.readBy.some((r) => String(r.userId) === String(userId))
        : Boolean(b.isRead),
      createdAt: b.createdAt || b.date,
      date: b.createdAt || b.date,
    }));

    const combinedList = [...userDirectNotifications, ...formattedBroadcasts].sort(
      (a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date)
    );

    return res.status(200).json({
      success: true,
      status: "success",
      count: combinedList.length,
      notifications: combinedList,
      data: combinedList,
    });
  } catch (error) {
    console.error("Fetch Notifications Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to fetch notifications.",
      error: error.message,
    });
  }
};

/**
 * @desc    Create and Send a Notification / Broadcast (Admin Only)
 * @route   POST /api/v1/admin/send-notification
 * @access  Private/Admin
 */
exports.createNotification = async (req, res) => {
  try {
    const {
      title,
      message,
      body,
      category,
      type,
      target,
      recipientId,
      userId,
      actionRoute,
    } = req.body;

    const finalTitle = String(title || "").trim();
    const finalMessage = String(message || body || "").trim();
    const targetUserId = recipientId || userId || null;

    if (!finalTitle || !finalMessage) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please provide both title and message for the notification.",
      });
    }

    const notificationPayload = {
      title: finalTitle,
      message: finalMessage,
      category: String(category || "ADMIN_BROADCAST").toUpperCase(),
      type: type || "info",
      target: target || (targetUserId ? "specific_users" : "all"),
      recipient: targetUserId,
      actionRoute: actionRoute || null,
      isRead: false,
      createdAt: new Date(),
      date: new Date(),
    };

    // A. Idan sanarwa ce ta mutum daya (Single User)
    if (targetUserId) {
      const recipientUser = await User.findById(targetUserId);
      if (!recipientUser) {
        return res.status(404).json({
          success: false,
          status: "failed",
          message: "Recipient user not found.",
        });
      }

      if (!recipientUser.notifications) recipientUser.notifications = [];
      recipientUser.notifications.unshift(notificationPayload);

      if (recipientUser.notifications.length > 100) {
        recipientUser.notifications = recipientUser.notifications.slice(0, 100);
      }
      await recipientUser.save();

      // Real-time socket dispatch
      try {
        if (typeof getIO === "function") {
          getIO(`user-notification-${targetUserId}`, notificationPayload);
        }
      } catch (sockErr) {}
    } else {
      // B. Idan Broadcast ce ga kowa (Global Broadcast)
      await Notification.create(notificationPayload);

      // Tura wa dukkan users a array dinsu
      await User.updateMany(
        {},
        {
          $push: {
            notifications: {
              $each: [notificationPayload],
              $position: 0,
              $slice: 100,
            },
          },
        }
      );

      // Real-time broadcast socket dispatch
      try {
        if (typeof getIO === "function") {
          getIO("global-broadcast", notificationPayload);
        }
      } catch (sockErr) {}
    }

    // Rubuta Activity Log
    await Activity.create({
      user: req.user._id,
      staffId: req.user._id,
      action: "SEND_NOTIFICATION",
      category: "ADMIN_CONTROL",
      details: `Dispatched Notification: "${finalTitle}" | Target: ${
        targetUserId ? `User (${targetUserId})` : `Broadcast (${target || "ALL"})`
      }`,
      targetUser: targetUserId,
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      status: "success",
      message: "Notification sent successfully.",
      data: notificationPayload,
    });
  } catch (error) {
    console.error("Create Notification Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Error creating and sending notification.",
      error: error.message,
    });
  }
};

/**
 * @desc    Get all notifications for Admin Management Dashboard
 * @route   GET /api/v1/admin/all-notifications
 * @access  Private/Admin
 */
exports.getAdminNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find()
      .populate("recipient", "surname firstName name fullName email phone")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      status: "success",
      count: notifications.length,
      notifications,
      data: notifications,
    });
  } catch (error) {
    console.error("Get Admin Notifications Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Error fetching admin notifications log.",
      error: error.message,
    });
  }
};

/**
 * @desc    Mark a notification as read
 * @route   PATCH /api/v1/notifications/:id/read
 * @access  Private (User)
 */
exports.markAsRead = async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user._id || req.user.id;

    // 1. Duba idan notification yana cikin User document
    await User.updateOne(
      { _id: userId, "notifications._id": notificationId },
      { $set: { "notifications.$.isRead": true } }
    );

    // 2. Duba idan sanarwar Broadcast ce a Notification Model
    await Notification.updateOne(
      { _id: notificationId, "readBy.userId": { $ne: userId } },
      {
        $push: {
          readBy: {
            userId: userId,
            readAt: new Date(),
          },
        },
      }
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: "Notification marked as read.",
    });
  } catch (error) {
    console.error("Mark As Read Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Error updating notification status.",
      error: error.message,
    });
  }
};

/**
 * @desc    Delete notification
 * @route   DELETE /api/v1/notifications/:id
 * @access  Private
 */
exports.deleteNotification = async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user._id || req.user.id;

    // Cire daga User notifications array
    await User.updateOne(
      { _id: userId },
      { $pull: { notifications: { _id: notificationId } } }
    );

    // Idan admin ne, zai iya goge Global Broadcast gaba daya
    if (req.user.role === "admin" || req.user.role === "superadmin") {
      await Notification.findByIdAndDelete(notificationId);
    }

    return res.status(200).json({
      success: true,
      status: "success",
      message: "Notification deleted successfully.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Error deleting notification.",
      error: error.message,
    });
  }
};