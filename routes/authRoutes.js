const express = require("express");
const router = express.Router();

const authController = require("../controllers/authController");

// ===============================
// AUTH ROUTES
// ===============================

// REGISTER
router.post("/register", authController.register);

// LOGIN
router.post("/login", authController.login);

// SUPERVISOR LOGIN
router.post("/supervisor-login", authController.supervisorLogin);

// PAYSTACK WEBHOOK
router.post("/paystack-webhook", authController.paystackWebhook);

// UPDATE PASSWORD
router.put("/update-password", authController.updatePassword);

// UPDATE PIN
router.put("/update-pin", authController.updatePin);

// GET PROFILE
router.get("/profile", authController.getUserProfile);

module.exports = router;
