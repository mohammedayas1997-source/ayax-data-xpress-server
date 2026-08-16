const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { protect } = require("../middleware/authMiddleware");
const pinController = require("../controllers/pinController");


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

// --- PIN MANAGEMENT ROUTES (POST da PUT don tallafawa ko wane request) ---
router.post("/create-pin", protect, pinController.createPin);
router.put("/create-pin", protect, pinController.createPin);

router.post("/update-pin", protect, pinController.updatePin);
router.put("/update-pin", protect, pinController.updatePin);

// --- PAYSTACK WEBHOOK ---
router.post("/paystack/webhook", authController.paystackWebhook);

module.exports = router;