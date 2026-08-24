const express = require("express");
const router = express.Router();

// 1. Dynamic Authentication Middleware Loader
let authMiddleware;
try {
  authMiddleware = require("../middleware/authMiddleware");
} catch (e) {
  authMiddleware = require("../middleware/auth");
}

const protect = authMiddleware.protect || authMiddleware.verifyToken || authMiddleware;
const authorize = authMiddleware.authorize || authMiddleware.restrictTo || ((...roles) => (req, res, next) => next());

// 2. Controller Functions
const {
  getMyNotifications,
  createNotification,
  getAdminNotifications,
  markAsRead,
  deleteNotification,
} = require("../controllers/notificationController");

// Safe Route Handler Helper
const safe = (fn, name) => {
  if (typeof fn === "function") return fn;
  return (req, res) => {
    return res.status(501).json({
      success: false,
      status: "failed",
      message: `Notification Controller handler '${name}' is not implemented yet.`,
    });
  };
};

// ==========================================
// 1. USER NOTIFICATION ROUTES
// ==========================================
// Fetch notifications for the logged-in user
router.get(
  "/",
  protect,
  safe(getMyNotifications, "getMyNotifications")
);

router.get(
  "/my-notifications",
  protect,
  safe(getMyNotifications, "getMyNotifications")
);

// Mark a notification as read
router.patch(
  "/:id/read",
  protect,
  safe(markAsRead, "markAsRead")
);

router.put(
  "/:id/read",
  protect,
  safe(markAsRead, "markAsRead")
);

// Delete or dismiss notification
router.delete(
  "/:id",
  protect,
  safe(deleteNotification, "deleteNotification")
);

// ==========================================
// 2. STAFF, CUSTOMER CARE, ADMIN & SUPERADMIN ROUTES
// ==========================================
// Send single notification or broadcast
router.post(
  "/send",
  protect,
  authorize("superadmin", "admin", "customer_service", "customer_care", "support", "agent_manager"),
  safe(createNotification, "createNotification")
);

router.post(
  "/admin/send",
  protect,
  authorize("superadmin", "admin", "customer_service", "customer_care", "support", "agent_manager"),
  safe(createNotification, "createNotification")
);

router.post(
  "/admin/send-notification",
  protect,
  authorize("superadmin", "admin", "customer_service", "customer_care", "support", "agent_manager"),
  safe(createNotification, "createNotification")
);

// View all sent notifications and dispatch history
router.get(
  "/admin/all",
  protect,
  authorize("superadmin", "admin", "customer_service", "customer_care", "support", "agent_manager"),
  safe(getAdminNotifications, "getAdminNotifications")
);

router.get(
  "/admin/all-notifications",
  protect,
  authorize("superadmin", "admin", "customer_service", "customer_care", "support", "agent_manager"),
  safe(getAdminNotifications, "getAdminNotifications")
);

module.exports = router;