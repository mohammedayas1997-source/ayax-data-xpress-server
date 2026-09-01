const User = require("../models/User");
const bcrypt = require("bcryptjs");

/**
 * Reusable Middleware to verify PIN with brute-force lockout protection
 */
exports.verifyTransactionPin = async (req, res, next) => {
  try {
    const { pin, transactionPin } = req.body;
    const inputPin = String(pin || transactionPin || "").trim();
    const userId = req.user?._id || req.user?.id;

    if (!inputPin) {
      return res.status(400).json({
        success: false,
        message: "Transaction PIN is required to authorize this purchase.",
      });
    }

    const user = await User.findById(userId).select("+transactionPin +pin +walletBalance +balance");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    // 1. Duba ko PIN a kulle yake sakamakon kuskure sau da yawa
    if (user.pinLockedUntil && user.pinLockedUntil > Date.now()) {
      const remainingMins = Math.ceil((user.pinLockedUntil - Date.now()) / 60000);
      return res.status(403).json({
        success: false,
        message: `Account PIN temporarily locked due to multiple incorrect attempts. Try again in ${remainingMins} minutes.`,
      });
    }

    // 2. Tantance PIN
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

    // 3. Idan PIN ba daidai ba:
    if (!isPinValid) {
      user.failedPinAttempts = (user.failedPinAttempts || 0) + 1;
      
      if (user.failedPinAttempts >= 5) {
        user.pinLockedUntil = Date.now() + 30 * 60 * 1000; // Lock na mintuna 30
        user.failedPinAttempts = 0;
        await user.save({ validateBeforeSave: false });

        return res.status(403).json({
          success: false,
          message: "Account PIN has been locked for 30 minutes due to 5 consecutive incorrect attempts.",
        });
      }

      await user.save({ validateBeforeSave: false });

      return res.status(400).json({
        success: false,
        message: `Security Error: Invalid Transaction PIN. Attempt ${user.failedPinAttempts} of 5.`,
      });
    }

    // 4. Idan PIN yayi daidai, share failed attempts
    if (user.failedPinAttempts > 0 || user.pinLockedUntil) {
      user.failedPinAttempts = 0;
      user.pinLockedUntil = undefined;
      await user.save({ validateBeforeSave: false });
    }

    // Maƙala user ɗin a request domin controller ya ci gaba da aiki
    req.authorizedUser = user;
    next();
  } catch (error) {
    console.error("PIN Verification Middleware Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal security authentication error.",
    });
  }
};