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

// Muna bukatar protect middleware dinka domin kiyaye sirrin asusu
const { protect } = require("../middleware/authMiddleware"); // Tabbatar sunan file din da folder dinsa haka suke

// --- Public Routes ---

// @route   POST /api/v1/auth/register
router.post("/register", register);

// @route   POST /api/v1/auth/login
router.post("/login", login);

// @route   POST /api/v1/auth/webhook (Paystack)
router.post("/webhook", paystackWebhook);

// --- Protected Routes (An bude su kuma an gyara kofar profile) ---

// 1. Wannan zai karbi kiran da frontend ke yi na Customer profile
router.get("/profile", protect, getMe);

// 2. Wadannan ma mun bude su domin su yi aiki lokacin da aka nemi sauya password ko fili
router.get("/me", protect, getMe);
router.put("/updatepassword", protect, updatePassword);
router.put("/updatepin", protect, updatePin);

module.exports = router;
