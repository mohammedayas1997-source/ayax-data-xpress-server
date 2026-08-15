const Notification = require("../models/Notification");
const User = require("../models/User");
const Activity = require("../models/Activity");

/**
 * @desc    Create and Send a Notification (Admin Only)
 * @route   POST /api/v1/admin/send-notification
 * @access  Private/Admin
 */
exports.createNotification = async (req, res) => {
  try {
    const { title, message, type, recipientId } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: "Please provide both title and message for the notification",
      });
    }

    let notificationData = {
      title,
      message,
      type: type || "general",
      sender: req.user._id,
    };

    // Idan an ba da recipientId, to sanarwar taje ga mutum daya ne, idan babu toh ta zama Broadcast ga kowa
    if (recipientId) {
      notificationData.recipient = recipientId;
    }

    const newNotification = await Notification.create(notificationData);

    // Rubuta Activity Log
    await Activity.create({
      staffId: req.user._id,
      action: "SEND_NOTIFICATION",
      details: `Title: ${title} | Target: ${recipientId ? "Single User" : "All Users (Broadcast)"}`,
      targetUser: recipientId || null,
    });

    res.status(201).json({
      success: true,
      message: "Notification sent successfully",
      data: newNotification,
    });
  } catch (error) {
    console.error("Create Notification Error:", error);
    res.status(500).json({
      success: false,
      message: "Error sending notification",
      error: error.message,
    });
  }
};

/**
 * @desc    Get all notifications for Admin Dashboard
 * @route   GET /api/v1/admin/all-notifications
 * @access  Private/Admin
 */
exports.getAdminNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find()
      .populate("recipient", "name email phone")
      .populate("sender", "name email")
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: notifications.length,
      data: notifications,
    });
  } catch (error) {
    console.error("Get Admin Notifications Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching notifications",
      error: error.message,
    });
  }
};

/**
 * @desc    Get logged in user's notifications
 * @route   GET /api/v1/notifications/my-notifications
 * @access  Private
 */
exports.getMyNotifications = async (req, res) => {
  try {
    const userId = req.user._id;

    // Dauko sanarwar da aka tura wa mutum daya Kai tsaye ko kuma wadanda suka shafi kowa (recipient: null)
    const notifications = await Notification.find({
      $or: [{ recipient: userId }, { recipient: { $exists: false } }, { recipient: null }],
    })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: notifications.length,
      data: notifications,
    });
  } catch (error) {
    console.error("Get My Notifications Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user notifications",
      error: error.message,
    });
  }
};

/**
 * @desc    Mark a notification as read
 * @route   PATCH /api/v1/notifications/:id/read
 * @access  Private
 */
exports.markAsRead = async (req, res) => {
  try {
    const notificationId = req.params.id;
    const userId = req.user._id;

    const notification = await Notification.findById(notificationId);
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    // Tabbatar cewa mai amfani yana da wuri a cikin readBy array, idan babu sai a saka shi
    if (!notification.readBy) {
      notification.readBy = [];
    }

    if (!notification.readBy.includes(userId)) {
      notification.readBy.push(userId);
      await notification.save();
    }

    res.status(200).json({
      success: true,
      message: "Notification marked as read",
    });
  } catch (error) {
    console.error("Mark As Read Error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating notification status",
      error: error.message,
    });
  }
};