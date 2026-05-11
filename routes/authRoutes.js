const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

// Tabbatar an shigo da ayyukan, idan babu su a saita su a matsayin empty function don gudun crash
const register =
  authController.register ||
  ((req, res) => res.status(500).json({ message: "Register not implemented" }));
const login =
  authController.login ||
  ((req, res) => res.status(500).json({ message: "Login not implemented" }));
const forgotPassword =
  authController.forgotPassword ||
  ((req, res) =>
    res.status(500).json({ message: "Forgot password not implemented" }));
const resetPassword =
  authController.resetPassword ||
  ((req, res) =>
    res.status(500).json({ message: "Reset password not implemented" }));

// Routes
router.post("/webhook", authController.paystackWebhook);
router.post("/register", register);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
module.exports = router;
