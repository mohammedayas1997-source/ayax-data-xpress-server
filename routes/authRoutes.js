const express = require("express");
const router = express.Router();

// Shigo da dukkan ayyukan
const authController = require("../controllers/authController");

// Mu duba idan kowane aiki yana nan kafin mu yi amfani da shi
const register = authController.register;
const login = authController.login;
const forgotPassword = authController.forgotPassword;
const resetPassword = authController.resetPassword;

// Idan daya daga cikinsu babu shi, Express zai bada wancan error din.
// Tabbatar kowane daya yana da controller a authController.js
router.post("/register", register);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

module.exports = router;
