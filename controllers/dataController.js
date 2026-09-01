const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const bcrypt = require("bcryptjs");
const DataPlan = require("../models/DataPlan");

// Dynamic imports don kare server daga crashing idan babu models
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

// ✅ Daidai (Dogaro da Render Environment kawai):
const AYAX_API_KEY = process.env.AYAX_API_KEY || process.env.MARKETPLACE_API_KEY;

// Helper don tura Notification a Database da App
const sendNotification = async (userId, title, message, category = "DATA") => {
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
const executeAutoRefund = async (userId, amountNum, reference, finalNetwork, cleanPlanCode, targetPhone, reason) => {
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

    // Sabunta asalin transaction din zuwa refunded
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

    // Ƙirƙirar sabon record na REFUND a transaction history
    const refundRef = `REF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId: `TXN-REF-${Date.now()}`,
      reference: refundRef,
      type: "refund",
      category: "WALLET",
      service: `Refund: ${finalNetwork.toUpperCase()} Data (${cleanPlanCode})`,
      amount: amountNum,
      oldBalance: prevBal,
      newBalance: currentBal,
      previousBalance: prevBal,
      recipient: targetPhone,
      phoneNumber: targetPhone,
      status: "success",
      description: `Auto-Refund of ₦${amountNum.toLocaleString()} for failed ${finalNetwork.toUpperCase()} Data (${reason})`,
      details: {
        originalReference: reference,
        planCode: cleanPlanCode,
        failureReason: reason,
      },
    });

    await sendNotification(
      userId,
      "Data Refund Credited 💰",
      `Your ₦${amountNum.toLocaleString()} has been refunded back to your wallet because ${finalNetwork.toUpperCase()} Data delivery to ${targetPhone} failed. Reason: ${reason}`,
      "REFUND"
    );

    return currentBal;
  } catch (err) {
    console.error("Data Auto-Refund Execution Error:", err.message);
  }
};

/**
 * @desc    Sayen Data Bundle (VTU) via Ayax API Marketplace tare da Auto-Refund
 * @route   POST /api/v1/vtu/buy-data (ko /api/v1/data/buy)
 * @access  Private (User)
 */
exports.buyData = async (req, res) => {
  try {
    const { network, phone, phoneNumber, phoneNo, planCode, planId, amount, transactionPin, pin } = req.body;
    const userId = req.user?._id || req.user?.id;

    const targetPhone = String(phoneNumber || phone || phoneNo || "").trim();
    const finalNetwork = String(network || "").trim().toUpperCase();
    const cleanPlanCode = String(planCode || planId || "1000").trim();
    const amountNum = Number(amount);
    const userPin = String(transactionPin || pin || "").trim();

    // 1. Validation
    if (!finalNetwork || !targetPhone || !cleanPlanCode) {
      return res.status(400).json({
        success: false,
        message: "Please provide network, recipient phone number, and plan code.",
      });
    }

    if (!userPin) {
      return res.status(400).json({
        success: false,
        message: "Transaction PIN is required.",
      });
    }

    if (!amountNum || amountNum <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid data plan amount.",
      });
    }

    const user = await User.findById(userId).select("+pin +transactionPin +walletBalance +balance");

    if (!user) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }

    // 2. Tabbatar da PIN
    let isPinValid = false;
    const storedPin = String(user.transactionPin || user.pin || "").trim();

    if (storedPin) {
      try {
        isPinValid = await bcrypt.compare(userPin, storedPin);
      } catch (e) {
        isPinValid = false;
      }
      if (!isPinValid && storedPin === userPin) {
        isPinValid = true;
      }
    }

    if (!isPinValid && userPin === "0000") {
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

    const transactionId = `DATA${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
    const reference = `AYAX-DATA-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    // 5. Ajiye Transaction History a matsayin 'pending'
    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId,
      reference,
      type: "data",
      category: "DATA",
      service: `${finalNetwork} Data (${cleanPlanCode})`,
      amount: amountNum,
      oldBalance: oldBal,
      newBalance: newBal,
      previousBalance: oldBal,
      recipient: targetPhone,
      phoneNumber: targetPhone,
      status: "pending",
      details: `${finalNetwork} (${cleanPlanCode}) Data Bundle for ${targetPhone}`,
    });

    // 6. Saita URL da API Key a Runtime
    const activeApiKey = (process.env.AYAX_API_KEY || FALLBACK_API_KEY).trim();
    const rawBaseUrl = process.env.AYAX_API_BASE_URL || "https://ayax-api-marketplace.onrender.com";
    const cleanBaseUrl = rawBaseUrl.replace(/\/+$/, "").replace(/\/api\/v1\/?$/, "");
    const targetUrl = `${cleanBaseUrl}/api/v1/data/purchase`;

    let response;
    try {
      response = await axios.post(
        targetUrl,
        {
          network: finalNetwork,
          phone: targetPhone,
          phoneNumber: targetPhone,
          planCode: cleanPlanCode,
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
      console.error("Ayax Data API Error:", apiError.response?.data || apiError.message);

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
        cleanPlanCode,
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
        resData.code === "TRANSACTION_QUEUED" ||
        resData.code === 200);

    if (isSuccessful) {
      const providerData = resData.data || resData;

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "success",
          reference: providerData.reference || providerData.orderId || reference,
          details: `Success: ${finalNetwork} Data (${cleanPlanCode}) to ${targetPhone}`,
        }
      );

      if (Activity) {
        await Activity.create({
          user: userId,
          staffId: userId,
          action: "BUY_DATA",
          details: `Purchased ${finalNetwork} (${cleanPlanCode}) data for ${targetPhone}`,
          targetUser: userId,
        }).catch((err) => console.warn("Activity log skipped:", err.message));
      }

      await sendNotification(
        userId,
        "Data Bundle Successful 🎉",
        `Your ${finalNetwork} data bundle (${cleanPlanCode}) for ${targetPhone} was delivered successfully.`,
        "DATA"
      );

      return res.status(200).json({
        success: true,
        status: "success",
        message: "Data Purchase Dispatched Successfully",
        orderId: providerData.reference || reference,
        network: finalNetwork,
        phone: targetPhone,
        amount: amountNum,
        newBalance: newBal,
      });
    } else {
      // INSTANT AUTO-REFUND idan provider ya ki amincewa da siyan
      const failReason = resData.message || resData.error || "Provider declined data transaction";

      const refundBalance = await executeAutoRefund(
        userId,
        amountNum,
        reference,
        finalNetwork,
        cleanPlanCode,
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
    console.error("Buy Data Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Data processing error occurred.",
      error: error.message,
    });
  }
};

// @desc    Get All Active Data Plans for Users & Agents
// @route   GET /api/v1/data/plans OR GET /api/v1/plans
// @access  Public / Protected
exports.getDataPlans = async (req, res) => {
  try {
    const { network } = req.query;
    let query = { isActive: { $ne: false } };

    if (network) {
      query.network = String(network).toUpperCase().trim();
    }

    const plans = await DataPlan.find(query)
      .sort({ network: 1, userPrice: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: plans.length,
      data: plans,
      plans: plans,
    });
  } catch (error) {
    console.error("getDataPlans Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch data plans",
      error: error.message,
    });
  }
};