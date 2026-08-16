const User = require("../models/User");
const bcrypt = require("bcryptjs");

// Set or Create PIN
exports.createPin = async (req, res) => {
  try {
    const pinToUse = req.body.newPin || req.body.pin;

    if (!pinToUse || pinToUse.length !== 4) {
      return res.status(400).json({
        success: false,
        message: "A valid 4-digit PIN is required.",
      });
    }

    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("+pin +transactionPin");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPin = await bcrypt.hash(pinToUse, salt);

    user.pin = hashedPin;
    user.transactionPin = hashedPin;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      success: true,
      message: "Transaction PIN successfully created.",
    });
  } catch (error) {
    console.error("Create PIN Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while creating PIN.",
      error: error.message,
    });
  }
};

// Update PIN
exports.updatePin = async (req, res) => {
  try {
    const { password } = req.body;
    const pinToUse = req.body.newPin || req.body.pin;

    if (!password || !pinToUse) {
      return res.status(400).json({
        success: false,
        message: "Please provide your account password and the new PIN.",
      });
    }

    if (pinToUse.length !== 4) {
      return res.status(400).json({
        success: false,
        message: "Transaction PIN must be exactly 4 digits.",
      });
    }

    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("+password +pin +transactionPin");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const isPasswordMatch = await user.matchPassword(password);
    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: "Incorrect account password. Authorization failed.",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPin = await bcrypt.hash(pinToUse, salt);

    user.pin = hashedPin;
    user.transactionPin = hashedPin;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      success: true,
      message: "Transaction PIN successfully updated.",
    });
  } catch (error) {
    console.error("Update PIN Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating PIN.",
      error: error.message,
    });
  }
};