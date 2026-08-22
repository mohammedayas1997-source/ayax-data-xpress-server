const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");

// Helper don kiyaye kuskuren undefined route handler
const safeAuth = (handlerName) => {
  return (req, res, next) => {
    if (typeof authController[handlerName] === "function") {
      return authController[handlerName](req, res, next);
    }
    return res.status(501).json({
      success: false,
      message: `Auth handler '${handlerName}' is not implemented yet.`,
    });
  };
};

// ==========================================
// 1. PUBLIC AUTHENTICATION ROUTES
// ==========================================
router.post("/register", safeAuth("register"));
router.post("/login", safeAuth("login"));
router.post("/supervisor-login", safeAuth("supervisorLogin"));
router.post("/forgot-password", safeAuth("forgotPassword"));
router.post("/reset-password", safeAuth("resetPassword"));

// Paystack Webhook (Public Callback)
router.post("/paystack/webhook", safeAuth("paystackWebhook"));

// ==========================================
// 2. PROTECTED USER PROFILE & SECURITY ROUTES
// ==========================================
router.use(protect);

router.get("/profile", (req, res) => {
  res.status(200).json({
    success: true,
    user: req.user,
    data: req.user,
  });
});

router.get("/me", (req, res) => {
  res.status(200).json({
    success: true,
    user: req.user,
    data: req.user,
  });
});

router.get("/check-auth", (req, res) => {
  res.status(200).json({
    success: true,
    authenticated: true,
    user: req.user,
  });
});

router.put("/update-password", safeAuth("updatePassword"));

// ==========================================
// 3. TRANSACTION PIN MANAGEMENT
// ==========================================
router.post("/create-pin", safeAuth("createPin"));
router.put("/create-pin", safeAuth("createPin"));

router.post("/update-pin", safeAuth("updatePin"));
router.put("/update-pin", safeAuth("updatePin"));

module.exports = router;