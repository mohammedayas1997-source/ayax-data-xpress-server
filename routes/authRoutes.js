const express = require("express");
const router = express.Router();
const User = require("../models/User"); // Tabbatar sunan model dinka User ne kuma yana nan

const {
  register,
  login,
  paystackWebhook,
  updatePassword,
  updatePin,
} = require("../controllers/authController");

// Muna amfani da protect middleware dinka
const { protect } = require("../middleware/authMiddleware");

// --- Public Routes ---
router.post("/register", register);
router.post("/login", login);
router.post("/webhook", paystackWebhook);

// --- Protected Routes ---

// Mun gina aikin profile din a nan kai-tsaye domin magance [Undefined] callback error
router.get("/profile", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res
        .status(404)
        .json({ status: "fail", message: "User not found" });
    }
    res.status(200).json({
      status: "success",
      data: user, // Ko kuma { user } dangane da yadda frontend dinka ke tsammani
    });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

// Haka ma ga wannan kofar idan frontend tana bukata
router.get("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res
        .status(404)
        .json({ status: "fail", message: "User not found" });
    }
    res.status(200).json({ status: "success", data: user });
  } catch (error) {
    res.status(500).json({ status: "error", message: error.message });
  }
});

// Wadannan idan suna da callback a controller, zaka iya barinsu
if (updatePassword) router.put("/updatepassword", protect, updatePassword);
if (updatePin) router.put("/updatepin", protect, updatePin);

module.exports = router;
