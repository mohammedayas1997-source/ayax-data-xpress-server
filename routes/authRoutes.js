const express = require("express");
const router = express.Router();
const {
  register,
  login,
  supervisorLogin,
  paystackWebhook,
  updatePassword,
  createPin,
  updatePin
} = require("../controllers/authController");

const { protect } = require("../middleware/authMiddleware");

// --- Public Routes ---
router.post("/register", register);
router.post("/login", login);
router.post("/supervisor-login", supervisorLogin);

// --- Webhook Route ---
router.post("/paystack-webhook", paystackWebhook);

// --- Protected Routes ---
router.put("/update-password", protect, updatePassword);

// PIN Management Routes (Taimakon POST da PUT don guje wa kuskuren Frontend)
router.post("/create-pin", protect, createPin);
router.put("/create-pin", protect, createPin);

router.post("/update-pin", protect, updatePin);
router.put("/update-pin", protect, updatePin);

module.exports = router;