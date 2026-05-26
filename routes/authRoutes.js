const express = require("express");
const router = express.Router();
const User = require("../models/User");

// 1. Shigo da dukkan functions sau ɗaya kawai
const {
  register,
  login,
  supervisorLogin,
  paystackWebhook,
  updatePassword,
  updatePin,
} = require("../controllers/authController");

const { protect } = require("../middleware/authMiddleware");

// --- Public Routes ---
router.post("/register", register);
router.post("/login", login);
router.post("/supervisor-login", supervisorLogin);
router.post("/webhook", paystackWebhook);

// --- Protected Routes ---
// Sauran routes naka...
router.get("/profile", protect, async (req, res) => {
  /* ... */
});
router.get("/me", protect, async (req, res) => {
  /* ... */
});

// Amfani da check don hana crash
if (updatePassword) router.put("/updatepassword", protect, updatePassword);
if (updatePin) router.put("/updatepin", protect, updatePin);

module.exports = router;
