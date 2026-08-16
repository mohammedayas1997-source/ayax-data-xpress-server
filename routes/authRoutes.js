const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");

// --- AUTHENTICATION ROUTES ---
router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/forgot-password", authController.forgotPassword);
router.post("/reset-password", authController.resetPassword);

// --- PROTECTED USER PROFILE & SECURITY ROUTES ---
router.get("/profile", protect, (req, res) => {
  res.status(200).json({ success: true, user: req.user });
});

router.put("/update-password", protect, authController.updatePassword);

// --- PIN MANAGEMENT ROUTES ---
router.post("/create-pin", protect, authController.createPin);
router.put("/create-pin", protect, authController.createPin);

router.post("/update-pin", protect, authController.updatePin);
router.put("/update-pin", protect, authController.updatePin);

// --- PAYSTACK WEBHOOK ---
router.post("/paystack/webhook", authController.paystackWebhook);

module.exports = router;