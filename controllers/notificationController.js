const Notification = require("../models/Notification");
const User = require("../models/User");

// DYNAMIC ACTIVITY MODEL LOADER
let Activity;
try {
  Activity = require("../models/Activity");
} catch (e) {
  Activity = null;
}

// Helper don kiran Socket instance idan yana aiki a server
let getIO;
try {
  const socketModule = require("../config/socket");
  getIO = socketModule.getIO || socketModule.emitEvent;
} catch (e) {
  getIO = null;
}

/**
 * @desc    Get logged in user's notifications (Daga User Array + Notification Collection + Webhook Alerts)
 * @route   GET /api/v1/notifications
 * @route   GET /api/v1/notifications/my-notifications
 * @access  Private (User)
 */
exports.getMyNotifications = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userRole = req.user.role || "user";
    const userLga = req.user.lga || "";
    const userState = req.user.state || "";

    const user = await User.findById(userId).select("notifications role lga state").lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "User account not found.",
      });
    }

    // 1. Dauko personal notifications daga User document array
    let userDirectNotifications = (user.notifications || []).map((n) => ({
      _id: n._id || n.id || Math.random().toString(),
      id: n._id || n.id,
      title: n.title || "Alert",
      message: n.message || n.body || "",
      category: n.category || "DIRECT",
      type: n.type || "info",
      actionRoute: n.actionRoute || null,
      isRead: Boolean(n.isRead || n.read),
      createdAt: n.createdAt || n.date || new Date(),
      date: n.createdAt || n.date || new Date(),
    }));

    // 2. Dauko dukkan sanarwa daga Notification Collection (ciki har da na Webhook da Broadcasts)
    const directAndBroadcastNotifications = await Notification.find({
      $or: [
        { recipient: userId },
        { user: userId },
        { userId: userId },
        { isBroadcast: true },
        { isGeneral: true },
        { target: "all" },
        { target: userRole },
        { targetRole: userRole },
        ...(userLga ? [{ lga: new RegExp(`^${userLga}$`, "i") }] : []),
        ...(userState ? [{ state: new RegExp(`^${userState}$`, "i") }] : []),
      ],
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // 3. Tsara su don su yi daidai da Frontend
    const formattedCollectionNotifications = directAndBroadcastNotifications.map((b) => ({
      _id: b._id,
      id: b._id,
      title: b.title || "Notification",
      message: b.message || b.body || "",
      category: b.category || b.type || "SYSTEM_ALERT",
      type: b.type || "info",
      actionRoute: b.actionRoute || null,
      isRead: Array.isArray(b.readBy)
        ? b.readBy.some((r) => String(r.userId || r) === String(userId))
        : Boolean(b.isRead || b.read),
      createdAt: b.createdAt || b.date || new Date(),
      date: b.createdAt || b.date || new Date(),
    }));

    // 4. Hadawa, Tace kwafi (Remove Duplicates), da Jerawa daga sabo zuwa tsoho
    const allCombined = [...userDirectNotifications, ...formattedCollectionNotifications];
    const uniqueMap = new Map();

    allCombined.forEach((item) => {
      const key = `${item.title}-${item.message}-${new Date(item.createdAt).getMinutes()}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, item);
      }
    });

    const combinedList = Array.from(uniqueMap.values()).sort(
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
 * @desc    Create and Send a Notification / Broadcast
 * @route   POST /api/v1/notifications/send
 * @route   POST /api/v1/admin/send-notification
 * @access  Private/Admin/Staff
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
      recipient,
      userId,
      actionRoute,
      lga,
      state,
      targetRole,
    } = req.body;

    const finalTitle = String(title || "").trim();
    const finalMessage = String(message || body || "").trim();
    const targetUserId = recipientId || recipient || userId || null;

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
      category: String(category || "GENERAL_NOTIFICATION").toUpperCase(),
      type: type || "info",
      target: target || (targetUserId ? "specific_users" : "all"),
      recipient: targetUserId,
      user: targetUserId,
      userId: targetUserId,
      sender: req.user?._id || req.user?.id,
      actionRoute: actionRoute || null,
      lga: lga || undefined,
      state: state || undefined,
      targetRole: targetRole || undefined,
      isBroadcast: Boolean(!targetUserId),
      isRead: false,
      read: false,
      status: "unread",
      createdAt: new Date(),
      date: new Date(),
    };

    // 1. Ajiye a Notification Collection
    const createdNotification = await Notification.create(notificationPayload);

    // 2. Ajiye a User array idan mutum daya ne
    if (targetUserId) {
      const recipientUser = await User.findById(targetUserId);
      if (recipientUser) {
        if (!recipientUser.notifications) recipientUser.notifications = [];
        recipientUser.notifications.unshift(notificationPayload);

        if (recipientUser.notifications.length > 100) {
          recipientUser.notifications = recipientUser.notifications.slice(0, 100);
        }
        await recipientUser.save({ validateBeforeSave: false });
      }

      // Real-time socket dispatch
      try {
        if (typeof getIO === "function") {
          getIO(`user-notification-${targetUserId}`, notificationPayload);
        }
      } catch (sockErr) {}
    } else {
      // 3. Idan Broadcast ce ga kowa, tura a User arrays
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
      ).catch(() => {});

      try {
        if (typeof getIO === "function") {
          getIO("global-broadcast", notificationPayload);
        }
      } catch (sockErr) {}
    }

    // Activity Log
    if (Activity && req.user?._id) {
      await Activity.create({
        user: req.user._id,
        staffId: req.user._id,
        action: "SEND_NOTIFICATION",
        category: "ADMIN_CONTROL",
        details: `Dispatched Notification: "${finalTitle}"`,
        targetUser: targetUserId,
      }).catch(() => {});
    }

    return res.status(201).json({
      success: true,
      status: "success",
      message: "Notification sent successfully.",
      data: createdNotification,
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

    // 1. Duba a User document array
    await User.updateOne(
      { _id: userId, "notifications._id": notificationId },
      { $set: { "notifications.$.isRead": true, "notifications.$.read": true } }
    );

    // 2. Duba a Notification Model
    await Notification.updateOne(
      { _id: notificationId },
      {
        $set: { isRead: true, read: true, status: "read" },
        $addToSet: {
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

    // Cire daga User array
    await User.updateOne(
      { _id: userId },
      { $pull: { notifications: { _id: notificationId } } }
    );

    // Cire daga Collection idan admin ne ko nasa ne
    await Notification.deleteOne({
      _id: notificationId,
      $or: [
        { recipient: userId },
        { user: userId },
        { sender: userId }
      ]
    });

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