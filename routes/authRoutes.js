const express = require("express");
const router = express.Router();
const {
  register,
  login,
  supervisorLogin,
  paystackWebhook,
  updatePassword,
  updatePin
} = require("../controllers/authController");

const { protect } = require("../middleware/authMiddleware");

// Routes na jama'a (Public Routes)
router.post("/register", register);
router.post("/login", login);
router.post("/supervisor-login", supervisorLogin);

// Paystack ko Ayax Webhook (Baya buƙatar authentication amma yana buƙatar a hankali wajen karbar data)
router.post("/paystack-webhook", paystackWebhook);

// Routes masu buƙatar mai amfani ya shiga (Protected Routes)
router.put("/update-password", protect, updatePassword);
router.put("/update-pin", protect, updatePin);

module.exports = router;