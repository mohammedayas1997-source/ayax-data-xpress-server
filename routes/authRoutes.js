const express = require("express");
const router = express.Router();

const User = require("../models/User");

// ================================
// CONTROLLERS
// ================================
const authController = require("../controllers/authController");

const {
  register,
  login,
  supervisorLogin,
  paystackWebhook,
  updatePassword,
  updatePin,
} = authController;

// ================================
// MIDDLEWARE
// ================================
const { protect } = require("../middleware/authMiddleware");

// ================================
// DEBUG (OPTIONAL)
// ================================
console.log("AUTH CONTROLLERS LOADED:");
console.log(Object.keys(authController));

// ================================
// VALIDATION (DEV SAFETY CHECK)
// ================================
const requiredControllers = {
  register,
  login,
  supervisorLogin,
  paystackWebhook,
};

Object.entries(requiredControllers).forEach(([name, fn]) => {
  if (typeof fn !== "function") {
    throw new Error(`❌ Controller missing: ${name}`);
  }
});

// ================================
// PUBLIC ROUTES
// ================================
router.post("/register", register);

router.post("/login", login);

router.post("/supervisor-login", supervisorLogin);

router.post("/webhook", paystackWebhook);

// ================================
// PROTECTED ROUTES
// ================================

// USER PROFILE
router.get("/profile", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.log("PROFILE ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// CURRENT USER
router.get("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.log("ME ERROR:", error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ================================
// OPTIONAL UPDATES
// ================================
if (typeof updatePassword === "function") {
  router.put("/updatepassword", protect, updatePassword);
}

if (typeof updatePin === "function") {
  router.put("/updatepin", protect, updatePin);
}

// ================================
// EXPORT
// ================================
module.exports = router;
