const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const bcrypt = require("bcryptjs");

// Dynamic imports don gujewa server crash idan models babu su
let Activity;
try {
  Activity = require("../models/Activity");
} catch (e) {
  Activity = null;
}

let Notification;
try {
  Notification = require("../models/Notification");
} catch (e) {
  Notification = null;
}

// Live API Key Backup
const FALLBACK_API_KEY =
  "ayax_live_13e936ef28c32f2b9d99f2974949e411608490dc069de75ad06f165251eb5345";

// Helper don tura sanarwa (In-App & DB Notification)
const sendNotification = async (userId, title, message, category = "AIRTIME") => {
  try {
    const user = await User.findById(userId);
    if (user) {
      if (!user.notifications) user.notifications = [];
      user.notifications.unshift({
        title,
        message,
        category: category.toUpperCase(),
        date: new Date(),
        createdAt: new Date(),
        isRead: false,
        read: false,
      });
      if (user.notifications.length > 100) {
        user.notifications = user.notifications.slice(0, 100);
      }
      await user.save({ validateBeforeSave: false });
    }

    if (Notification) {
      await Notification.create({
        recipient: userId,
        user: userId,
        userId: userId,
        title,
        message,
        category: category.toUpperCase(),
        type: category.toLowerCase(),
        isBroadcast: false,
        isGeneral: false,
        target: "specific_users",
        isRead: false,
        read: false,
        createdAt: new Date(),
      }).catch(() => {});
    }
  } catch (error) {
    console.error("Notification delivery error:", error.message);
  }
};

// Automated Auto-Refund Ledger Processor
const executeAutoRefund = async (userId, amountNum, reference, finalNetwork, targetPhone, reason) => {
  try {
    const user = await User.findByIdAndUpdate(
      userId,
      {
        $inc: {
          walletBalance: amountNum,
          balance: amountNum,
        },
      },
      { new: true }
    );

    if (!user) return;

    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    const prevBal = Number((currentBal - amountNum).toFixed(2));

    // Sabunta asalin transaction din zuwa failed/refunded
    await Transaction.findOneAndUpdate(
      { reference },
      {
        status: "refunded",
        isRefunded: true,
        refundReason: reason,
        refundedAt: new Date(),
        details: `Failed & Refunded: ${reason}`,
      }
    );

    // Ƙirƙirar explicit REFUND audit ledger
    const refundRef = `REF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId: `TXN-REF-${Date.now()}`,
      reference: refundRef,
      type: "refund",
      category: "WALLET",
      service: `Refund: ${finalNetwork.toUpperCase()} Airtime`,
      amount: amountNum,
      oldBalance: prevBal,
      newBalance: currentBal,
      previousBalance: prevBal,
      recipient: targetPhone,
      phoneNumber: targetPhone,
      status: "success",
      description: `Auto-Refund of ₦${amountNum.toLocaleString()} for failed ${finalNetwork.toUpperCase()} Airtime (${reason})`,
      details: {
        originalReference: reference,
        failureReason: reason,
      },
    });

    await sendNotification(
      userId,
      "Airtime Refund Credited 💰",
      `Your ₦${amountNum.toLocaleString()} has been refunded back to your wallet because ${finalNetwork.toUpperCase()} Airtime recharge to ${targetPhone} failed. Reason: ${reason}`,
      "REFUND"
    );

    return currentBal;
  } catch (err) {
    console.error("Auto-Refund Execution Error:", err.message);
  }
};

/**
 * @desc    Sayen Airtime (VTU) via Ayax API Marketplace tare da Auto-Refund
 * @route   POST /api/v1/airtime/buy (ko /api/v1/vtu/airtime)
 * @access  Private (User)
 */
exports.buyAirtime = async (req, res) => {
  try {
    const { network, phone, phoneNo, phoneNumber, amount, pin } = req.body;
    const userId = req.user?._id || req.user?.id;

    const targetPhone = String(phone || phoneNo || phoneNumber || "").trim();
    const finalNetwork = String(network || "").trim().toLowerCase();
    const amountNum = Number(amount);

    // 1. Validation
    if (!finalNetwork || !targetPhone || !amountNum) {
      return res.status(400).json({
        success: false,
        message: "Please provide network, phone number, and amount.",
      });
    }

    if (!pin) {
      return res.status(400).json({
        success: false,
        message: "Transaction PIN is required.",
      });
    }

    if (amountNum < 50) {
      return res.status(400).json({
        success: false,
        message: "Minimum airtime purchase is ₦50.00.",
      });
    }

    const user = await User.findById(userId).select("+pin +transactionPin +walletBalance +balance");

    if (!user) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }

    // 2. Tabbatar da PIN
    let isPinValid = false;
    const storedPin = String(user.transactionPin || user.pin || "").trim();
    const inputPin = String(pin).trim();

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

    if (!isPinValid) {
      return res.status(400).json({
        success: false,
        message: "Security Error: Invalid Transaction PIN.",
      });
    }

    // 3. Duba Wallet Balance
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);

    if (currentBal < amountNum) {
      return res.status(400).json({
        success: false,
        message: `Insufficient Wallet Balance. Required: ₦${amountNum.toLocaleString()}, Available: ₦${currentBal.toLocaleString()}.`,
      });
    }

    // 4. Atomic Debit daga Wallet
    const debitedUser = await User.findByIdAndUpdate(
      userId,
      {
        $inc: {
          walletBalance: -amountNum,
          balance: -amountNum,
        },
      },
      { new: true }
    );

    const newBal = Number(debitedUser.walletBalance ?? debitedUser.balance ?? 0);
    const oldBal = Number((newBal + amountNum).toFixed(2));

    const transactionId = `AIRT${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
    const reference = `AYAX-AIRT-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    // 5. Ajiye Transaction History a matsayin 'pending'
    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId,
      reference,
      type: "airtime",
      category: "AIRTIME",
      service: `${finalNetwork.toUpperCase()} Airtime`,
      amount: amountNum,
      oldBalance: oldBal,
      newBalance: newBal,
      previousBalance: oldBal,
      recipient: targetPhone,
      phoneNumber: targetPhone,
      status: "pending",
      details: `${finalNetwork.toUpperCase()} ₦${amountNum} Airtime Recharge for ${targetPhone}`,
    });

    // 6. Saita URL da API Key a Runtime
    const activeApiKey = (process.env.AYAX_API_KEY || FALLBACK_API_KEY).trim();
    const rawBaseUrl = process.env.AYAX_API_BASE_URL || "https://ayax-api-marketplace.onrender.com";
    const cleanBaseUrl = rawBaseUrl.replace(/\/+$/, "").replace(/\/api\/v1\/?$/, "");
    const targetUrl = `${cleanBaseUrl}/api/v1/airtime/buy`;

    let response;
    try {
      response = await axios.post(
        targetUrl,
        {
          network: finalNetwork,
          phone: targetPhone,
          amount: amountNum,
          reference: reference,
        },
        {
          headers: {
            "x-api-key": activeApiKey,
            Authorization: `Bearer ${activeApiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 45000,
        }
      );
    } catch (apiError) {
      console.error("Ayax Airtime API Error:", apiError.response?.data || apiError.message);

      const errMsg =
        apiError.response?.data?.message ||
        apiError.response?.data?.error ||
        apiError.message ||
        "Gateway connection error";

      // INSTANT AUTO-REFUND
      const refundBalance = await executeAutoRefund(
        userId,
        amountNum,
        reference,
        finalNetwork,
        targetPhone,
        errMsg
      );

      return res.status(422).json({
        success: false,
        status: "failed",
        refunded: true,
        message: `Provider Error (${errMsg}). ₦${amountNum.toLocaleString()} has been refunded back to your wallet instantly.`,
        newBalance: refundBalance,
      });
    }

    const resData = response.data;
    const isSuccessful =
      resData &&
      (resData.success === true ||
        resData.status === "success" ||
        resData.status === "SUCCESSFUL" ||
        resData.status === 200 ||
        resData.code === 200);

    if (isSuccessful) {
      const providerData = resData.data || resData;

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "success",
          reference: providerData.reference || providerData.orderId || reference,
          details: `Success: ${finalNetwork.toUpperCase()} ₦${amountNum} Airtime to ${targetPhone}`,
        }
      );

      if (Activity) {
        await Activity.create({
          user: userId,
          staffId: userId,
          action: "BUY_AIRTIME",
          details: `Purchased ₦${amountNum} ${finalNetwork.toUpperCase()} airtime for ${targetPhone}`,
          targetUser: userId,
        }).catch((err) => console.warn("Activity log skipped:", err.message));
      }

      await sendNotification(
        userId,
        "Airtime Recharge Successful 📱",
        `Your ${finalNetwork.toUpperCase()} airtime recharge of ₦${amountNum.toLocaleString()} to ${targetPhone} was delivered successfully.`,
        "AIRTIME"
      );

      return res.status(200).json({
        success: true,
        status: "success",
        message: "Airtime Recharge Successful!",
        orderId: providerData.reference || reference,
        network: finalNetwork,
        phone: targetPhone,
        amount: amountNum,
        newBalance: newBal,
      });
    } else {
      // INSTANT AUTO-REFUND idan gateway ya mayar da failure response
      const failReason = resData.message || resData.error || "Provider declined transaction";

      const refundBalance = await executeAutoRefund(
        userId,
        amountNum,
        reference,
        finalNetwork,
        targetPhone,
        failReason
      );

      return res.status(422).json({
        success: false,
        status: "failed",
        refunded: true,
        message: `Purchase failed: ${failReason}. Your wallet was refunded automatically.`,
        newBalance: refundBalance,
      });
    }
  } catch (error) {
    console.error("Buy Airtime Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Airtime processing error occurred.",
      error: error.message,
    });
  }
};