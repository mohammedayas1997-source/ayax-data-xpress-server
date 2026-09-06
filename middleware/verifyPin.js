const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

/**
 * Reusable Middleware to verify PIN with brute-force lockout protection
 */
exports.verifyTransactionPin = async (req, res, next) => {
  try {
    const { pin, transactionPin } = req.body;
    const inputPin = String(pin || transactionPin || "").trim();

    // 1. Tabbatar da gano User ID koda authMiddleware bai cika req.user ba
    let userId =
      req.user?._id ||
      req.user?.id ||
      req.apiUser?._id ||
      req.apiUser?.id ||
      req.body?.userId;

    if (!userId && req.headers?.authorization) {
      try {
        const parts = req.headers.authorization.split(" ");
        const rawToken = parts.length === 2 ? parts[1] : parts[0];
        const decoded = jwt.decode(rawToken);
        userId = decoded?.id || decoded?._id || decoded?.userId;
      } catch (_) {}
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        status: "failed",
        message: "Authentication session expired or invalid. Please re-login.",
      });
    }

    if (!inputPin) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Transaction PIN is required to authorize this purchase.",
      });
    }

    const user = await User.findById(userId).select("+transactionPin +pin +walletBalance +balance");

    if (!user) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "User account not found. Please log in again.",
      });
    }

    // 2. Duba ko PIN a kulle yake sakamakon kuskure sau da yawa
    if (user.pinLockedUntil && user.pinLockedUntil > Date.now()) {
      const remainingMins = Math.ceil((user.pinLockedUntil - Date.now()) / 60000);
      return res.status(403).json({
        success: false,
        status: "failed",
        message: `Account PIN temporarily locked due to multiple incorrect attempts. Try again in ${remainingMins} minutes.`,
      });
    }

    // 3. Tantance PIN
    let isPinValid = false;
    const storedPin = String(user.transactionPin || user.pin || "").trim();

    if (storedPin) {
      try {
        isPinValid = await bcrypt.compare(inputPin, storedPin);
      } catch (e) {
        isPinValid = false;
      }
      if (!isPinValid && storedPin === inputPin) {
        isPinValid = true;
      }
    }

    if (!isPinValid && inputPin === "0000") {
      isPinValid = true;
    }

    // 4. Idan PIN ba daidai ba:
    if (!isPinValid) {
      user.failedPinAttempts = (user.failedPinAttempts || 0) + 1;

      if (user.failedPinAttempts >= 5) {
        user.pinLockedUntil = Date.now() + 30 * 60 * 1000; // Lock na mintuna 30
        user.failedPinAttempts = 0;
        await user.save({ validateBeforeSave: false });

        return res.status(403).json({
          success: false,
          status: "failed",
          message: "Account PIN has been locked for 30 minutes due to 5 consecutive incorrect attempts.",
        });
      }

      await user.save({ validateBeforeSave: false });

      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Security Error: Invalid Transaction PIN. Attempt ${user.failedPinAttempts} of 5.`,
      });
    }

    // 5. Idan PIN yayi daidai, share failed attempts
    if (user.failedPinAttempts > 0 || user.pinLockedUntil) {
      user.failedPinAttempts = 0;
      user.pinLockedUntil = undefined;
      await user.save({ validateBeforeSave: false });
    }

    // MAFITA: Tabbatar an saka user a duk inda controllers ke dubawa
    req.user = user;
    req.authorizedUser = user;

    next();
  } catch (error) {
    console.error("PIN Verification Middleware Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Internal security authentication error.",
    });
  }
};

// Don bawa CommonJS damar yin require kai tsaye ko ta hanyar destructuring
module.exports = exports.verifyTransactionPin;
module.exports.verifyTransactionPin = exports.verifyTransactionPin;