const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const User = require("../models/User");

// 1. Dynamic Authentication Middleware Loader
let authMiddleware;
try {
  authMiddleware = require("../middleware/authMiddleware");
} catch (e) {
  authMiddleware = require("../middleware/auth");
}

const protect =
  authMiddleware.protect || authMiddleware.verifyToken || authMiddleware;

// Safe Route Handler Helper
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

// Fresh Profile Lookup Handler
const getFreshUserProfile = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const user = await User.findById(userId).select("-password -pin -transactionPin").lean();

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    // Tabbatar da matsayin SuperAdmin idan asusunka ne
    const isOwner =
      user.phone === "09033738409" ||
      String(user.email).toLowerCase() === "mohammed.ayas@ayaxdata.online";

    if (isOwner) {
      user.role = "superadmin";
    }

    return res.status(200).json({
      success: true,
      user,
      data: user,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

router.get("/profile", getFreshUserProfile);
router.get("/me", getFreshUserProfile);

router.get("/check-auth", async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const user = await User.findById(userId).select("-password -pin -transactionPin").lean();
    
    return res.status(200).json({
      success: true,
      authenticated: true,
      user: user || req.user,
    });
  } catch (error) {
    return res.status(200).json({
      success: true,
      authenticated: true,
      user: req.user,
    });
  }
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