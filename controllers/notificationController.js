const Activity = require("../models/Activity"); // Don adana tarihin sanarwa idan kana so

// @desc    Create a new notification
// @route   POST /api/v1/admin/send-notification
// @access  Private/Admin
exports.createNotification = async (req, res) => {
  try {
    const { title, message, type } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: "Please provide both title and message for the notification",
      });
    }

    // A nan za ka iya saka logic na tura Push Notification ko adanawa a Database
    // Misali: Adanawa a matsayin Activity
    await Activity.create({
      staffId: req.user._id,
      action: "SEND_NOTIFICATION",
      details: `Title: ${title} | Message: ${message}`,
    });

    res.status(201).json({
      success: true,
      message: "Notification sent successfully",
      data: { title, message, type: type || "general" },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error sending notification",
      error: error.message,
    });
  }
};

// @desc    Get all notifications
// @route   GET /api/v1/admin/all-notifications
// @access  Private/Admin
exports.getNotifications = async (req, res) => {
  try {
    // Kuna iya dauko su daga wani Notification Model idan kun kirkira
    // A yanzu, bari mu dauko daga Activity wadanda suke da alaka da notifications
    const notifications = await Activity.find({
      action: "SEND_NOTIFICATION",
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: notifications.length,
      data: notifications,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching notifications",
      error: error.message,
    });
  }
};
