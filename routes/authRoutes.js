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

router.post("/register", register);
router.post("/login", login);
router.post("/supervisor-login", supervisorLogin);
router.post("/paystack-webhook", paystackWebhook);
router.put("/update-password", updatePassword); // Misali ko router.get()
router.put("/update-pin", updatePin);

module.exports = router;