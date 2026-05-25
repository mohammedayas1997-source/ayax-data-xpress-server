const express = require("express");
const router = express.Router();

const User = require("../models/User");

// ================================
// CONTROLLERS
// ================================
const authController = require("../controllers/authController");

const register =
  authController.register ||
  ((req, res) => {
    res.status(500).json({
      success: false,
      message: "Register controller missing",
    });
  });

const login =
  authController.login ||
  ((req, res) => {
    res.status(500).json({
      success: false,
      message: "Login controller missing",
    });
  });

const supervisorLogin =
  authController.supervisorLogin ||
  ((req, res) => {
    res.status(500).json({
      success: false,
      message: "Supervisor login controller missing",
    });
  });

const paystackWebhook =
  authController.paystackWebhook ||
  ((req, res) => {
    res.status(200).json({
      success: true,
      message: "Webhook received",
    });
  });

const updatePassword =
  authController.updatePassword ||
  ((req, res) => {
    res.status(500).json({
      success: false,
      message: "Update password controller missing",
    });
  });

const updatePin =
  authController.updatePin ||
  ((req, res) => {
    res.status(500).json({
      success: false,
      message: "Update pin controller missing",
    });
  });

// ================================
// MIDDLEWARE
// ================================
const { protect } = require("../middleware/authMiddleware");

// ================================
// DEBUG LOGS
// ================================
console.log("AUTH CONTROLLERS:");
console.log(Object.keys(authController));

// ================================
// PUBLIC ROUTES
// ================================
router.post("/register", register);

router.post("/login", login);

router.post("/supervisor-login", supervisorLogin);

router.post("/webhook", paystackWebhook);

// ================================
// PROTECTED ROUTES
// ================================

// USER PROFILE
router.get("/profile", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.log("PROFILE ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// CURRENT USER
router.get("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.log("ME ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// UPDATE PASSWORD
router.put("/updatepassword", protect, updatePassword);

// UPDATE PIN
router.put("/updatepin", protect, updatePin);

// ================================
// EXPORT
// ================================
module.exports = router;
