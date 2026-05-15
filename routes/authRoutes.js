const express = require("express");
const router = express.Router();
const {
  register,
  login,
  getMe,
  paystackWebhook,
  updatePassword,
  updatePin,
} = require("../controllers/authController");

// --- Public Routes ---

// @route   POST /api/v1/auth/register
router.post("/register", register);

// @route   POST /api/v1/auth/login
router.post("/login", login);

// @route   POST /api/v1/auth/webhook (Paystack)
router.post("/webhook", paystackWebhook);

// --- Protected Routes (Idan kana da protect middleware) ---
// router.get("/me", protect, getMe);
// router.put("/updatepassword", protect, updatePassword);
// router.put("/updatepin", protect, updatePin);

module.exports = router;
