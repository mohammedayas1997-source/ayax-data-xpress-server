const express = require("express");
const router = express.Router();

const {
  register,
  login,
  supervisorLogin,
  paystackWebhook,
  updatePassword,
  updatePin,
  getUserProfile,
} = require("../controllers/authController");

// ================================
// AUTH ROUTES
// ================================

// Register User
router.post("/register", register);

// Normal Login
router.post("/login", login);

// Supervisor Login
router.post("/supervisor-login", supervisorLogin);

// Paystack Webhook
router.post("/paystack/webhook", paystackWebhook);

// Update Password
router.put("/update-password", updatePassword);

// Update PIN
router.put("/update-pin", updatePin);

// Get User Profile
router.get("/profile", getUserProfile);

module.exports = router;
