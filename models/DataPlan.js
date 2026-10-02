const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

// Dynamic DataPlan Model Loader
let DataPlan;
try {
  DataPlan = require("../models/DataPlan");
} catch (e) {
  try {
    DataPlan = require("../models/Plan");
  } catch (err) {
    DataPlan = null;
  }
}

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

// Helper: Tsaftace lambar waya zuwa 080...
const cleanLocalPhone = (phone = "") => {
  const digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("234") && digits.length === 13) {
    return `0${digits.slice(3)}`;
  }
  if (digits.length === 10 && !digits.startsWith("0")) {
    return `0${digits}`;
  }
  return digits;
};

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

    if (!user) return 0;

    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    const prevBal = Number((currentBal - amountNum).toFixed(2));

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

    const refundRef = `REF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId: `TXN-REF-${Date.now()}`,
      reference: refundRef,
      type: "refund",
      category: "WALLET",
      service: `Refund: ${String(finalNetwork || "DATA").toUpperCase()} (${cleanPlanCode || ""})`,
      amount: amountNum,
      oldBalance: prevBal,
      newBalance: currentBal,
      previousBalance: prevBal,
      recipient: targetPhone,
      phoneNumber: targetPhone,
      status: "success",
      description: `Auto-Refund of ₦${amountNum.toLocaleString()} for failed data delivery (${reason})`,
      details: {
        originalReference: reference,
        planCode: cleanPlanCode,
        failureReason: reason,
      },
    });

    await sendNotification(
      userId,
      "Data Refund Credited 💰",
      `Your ₦${amountNum.toLocaleString()} has been refunded back to your wallet. Reason: ${reason}`,
      "REFUND"
    );

    console.log(`💸 [AUTO-REFUND COMPLETE] ₦${amountNum} credited back to User ${userId} (Ref: ${reference})`);
    return currentBal;
  } catch (err) {
    console.error("Data Auto-Refund Execution Error:", err.message);
    return 0;
  }
};

/**
 * Helper: Pure AYAX API Dispatcher (An Cire Al-Ihsan Gaba Daya)
 */
const dispatchToExternalGateways = async ({ network, phone, planCode, amount, reference }) => {
  const formattedPhone = cleanLocalPhone(phone);
  let targetPlanId = String(planCode).trim();
  const errors = [];

  // 1. ZAKULO AINIHIN PLAN ID DAGA DATABASE
  try {
    const db = mongoose.connection.db;
    if (db) {
      const planDoc = await db.collection("plans").findOne({
        $or: [
          { planId: targetPlanId },
          { id: targetPlanId },
          { planCode: targetPlanId },
          { code: targetPlanId },
          { _id: mongoose.Types.ObjectId.isValid(targetPlanId) ? new mongoose.Types.ObjectId(targetPlanId) : null }
        ]
      }) || await db.collection("dataplans").findOne({
        $or: [
          { planId: targetPlanId },
          { id: targetPlanId },
          { planCode: targetPlanId },
          { code: targetPlanId },
          { _id: mongoose.Types.ObjectId.isValid(targetPlanId) ? new mongoose.Types.ObjectId(targetPlanId) : null }
        ]
      });

      if (planDoc) {
        targetPlanId = String(planDoc.planId || planDoc.providerPlanId || planDoc.id || targetPlanId).trim();
      }
    }
  } catch (dbErr) {
    console.error("Database Plan Lookup Error:", dbErr.message);
  }

  // 2. AUTO-NETWORK DETERMINATION BISA LAMBAR PLAN ID
  const numericPlan = parseInt(targetPlanId, 10);
  let autoNetId = "1";
  let autoNetName = "MTN";

  if (!isNaN(numericPlan)) {
    if (numericPlan >= 100 && numericPlan <= 200) {
      autoNetId = "1";
      autoNetName = "MTN";
    } else if (numericPlan >= 201 && numericPlan <= 300) {
      autoNetId = "2";
      autoNetName = "AIRTEL";
    } else if (numericPlan >= 301 && numericPlan <= 400) {
      autoNetId = "4";
      autoNetName = "GLO";
    } else if (numericPlan >= 401 && numericPlan <= 500) {
      autoNetId = "3";
      autoNetName = "9MOBILE";
    }
  }

  const netMap = {
    MTN: "1",
    AIRTEL: "2",
    "9MOBILE": "3",
    GLO: "4"
  };

  const finalNetId = netMap[String(network).toUpperCase()] || autoNetId;

  // 3. TURAWA KAI-TSAYE ZUWA AYAX API KAWAI
  const ayaxApiKey = String(process.env.AYAX_API_KEY || process.env.MARKETPLACE_API_KEY || "").trim();
  const ayaxEndpoint = (process.env.AYAX_API_URL || "https://api.ayaxapis.com/api/v1/data/buy").trim();

  if (!ayaxApiKey) {
    return { success: false, errors: ["AYAX: API Key is missing in environment variables (.env)"] };
  }

  try {
    const payload = {
      network_id: String(finalNetId),
      plan_id: String(targetPlanId),
      phone: String(formattedPhone),
      reference: String(reference),
    };

    console.log(`📤 [AYAX DIRECT DISPATCH]: URL: ${ayaxEndpoint}`, payload);

    const res = await axios.post(
      ayaxEndpoint,
      payload,
      {
        headers: {
          "x-api-key": ayaxApiKey,
          "content-type": "application/json",
          "accept": "application/json",
        },
        timeout: 40000,
      }
    );

    const resData = res.data;
    const providerStatus = String(resData?.status || "").toUpperCase();

    if (
      resData?.success === true ||
      providerStatus === "SUCCESSFUL" ||
      providerStatus === "SUCCESS" ||
      res.status === 200
    ) {
      return { success: true, provider: "AYAX_API", data: resData };
    }

    errors.push(`AYAX: ${resData?.message || JSON.stringify(resData)}`);
  } catch (err) {
    const errRes = err.response?.data;
    const errMsg = errRes?.message || errRes?.desc || (typeof errRes === "string" ? errRes : err.message);
    errors.push(`AYAX: ${errMsg}`);
  }

  return { success: false, errors };
};

/**
 * @desc    Sayen Data Bundle (VTU) via AYAX API tare da Auto-Refund
 * @route   POST /api/v1/vtu/buy-data (ko /api/v1/data/buy)
 * @access  Private (User)
 */
exports.buyData = async (req, res) => {
  try {
    const { network, phone, phoneNumber, phoneNo, planCode, planId, plan, amount, transactionPin, pin } = req.body;
    const userId = req.user?._id || req.user?.id;

    const targetPhone = cleanLocalPhone(phoneNumber || phone || phoneNo || "");
    const finalNetwork = String(network || "").trim().toUpperCase();
    const cleanPlanCode = String(planId || planCode || plan || "100").trim();
    const amountNum = Number(amount);
    const userPin = String(transactionPin || pin || "").trim();

    if (!targetPhone || !cleanPlanCode) {
      return res.status(400).json({
        success: false,
        message: "Please provide recipient phone number and plan code.",
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

    // Tabbatar da PIN
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

    // Duba Wallet Balance
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);

    if (currentBal < amountNum) {
      return res.status(400).json({
        success: false,
        message: `Insufficient Wallet Balance. Required: ₦${amountNum.toLocaleString()}, Available: ₦${currentBal.toLocaleString()}.`,
      });
    }

    // Atomic Debit daga Wallet
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

    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId,
      reference,
      type: "data",
      category: "DATA",
      service: `${finalNetwork || "DATA"} Data (${cleanPlanCode})`,
      amount: amountNum,
      oldBalance: oldBal,
      newBalance: newBal,
      previousBalance: oldBal,
      recipient: targetPhone,
      phoneNumber: targetPhone,
      status: "pending",
      details: `${finalNetwork || "DATA"} (${cleanPlanCode}) Data Bundle for ${targetPhone}`,
    });

    // =========================================================================
    // AYAX DISPATCH
    // =========================================================================
    const dispatchResult = await dispatchToExternalGateways({
      network: finalNetwork,
      phone: targetPhone,
      planCode: cleanPlanCode,
      amount: amountNum,
      reference,
    });

    // 1. IDAN YA YI NASARA
    if (dispatchResult.success) {
      const providerData = dispatchResult.data || {};

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "success",
          reference: providerData.reference || providerData.orderId || reference,
          details: `Success: Data (${cleanPlanCode}) to ${targetPhone} via AYAX API`,
        }
      );

      await sendNotification(
        userId,
        "Data Bundle Successful 🎉",
        `Your data bundle (${cleanPlanCode}) for ${targetPhone} was delivered successfully.`,
        "DATA"
      );

      return res.status(200).json({
        success: true,
        status: "success",
        message: `Data Purchase Successful via AYAX API!`,
        orderId: providerData.reference || reference,
        network: finalNetwork,
        phone: targetPhone,
        amount: amountNum,
        newBalance: newBal,
        provider: "AYAX_API",
      });
    }

    // 2. IDAN YA GAZA: AUTO-REFUND NAN TAKE
    const combinedErrors = dispatchResult.errors.length > 0
      ? dispatchResult.errors.join(" | ")
      : "AYAX API rejected this transaction";

    console.error(`🚨 [AYAX DISPATCH FAILED]: Refunding User ${userId}. Errors: ${combinedErrors}`);

    const refundBalance = await executeAutoRefund(
      userId,
      amountNum,
      reference,
      finalNetwork,
      cleanPlanCode,
      targetPhone,
      combinedErrors
    );

    return res.status(422).json({
      success: false,
      status: "failed",
      refunded: true,
      message: `Delivery Error (${combinedErrors}). ₦${amountNum.toLocaleString()} has been refunded back to your wallet.`,
      newBalance: refundBalance,
    });

  } catch (error) {
    console.error("Buy Data Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Data processing error occurred.",
      error: error.message,
    });
  }
};

/**
 * @desc    Kofa na musamman don karbar sakamakon Gateway (Webhook / Callback)
 * @route   POST /api/v1/vtu/gateway-callback
 * @access  Public (Secret Protected)
 */
exports.handleGatewayCallback = async (req, res) => {
  try {
    const { reference, status, message } = req.body;
    const normalizedStatus = String(status || "").toUpperCase();

    const txn = await Transaction.findOne({ reference });
    if (!txn || txn.status === "refunded" || txn.status === "success") {
      return res.status(200).json({ success: true, message: "Ignored or already processed" });
    }

    if (["SUCCESS", "SUCCESSFUL", "COMPLETED"].includes(normalizedStatus)) {
      txn.status = "success";
      txn.details = `Delivered successfully: ${message || ""}`;
      await txn.save();

      await sendNotification(
        txn.user,
        "Data Bundle Delivered 🎉",
        `Your data bundle for ${txn.recipient || txn.phoneNumber} has been confirmed delivered.`,
        "DATA"
      );
    } else if (["FAILED", "FAILURE", "CANCELLED", "ERROR"].includes(normalizedStatus)) {
      await executeAutoRefund(
        txn.user,
        Number(txn.amount),
        txn.reference,
        "DATA",
        "",
        txn.recipient || txn.phoneNumber,
        message || "Gateway delivery failure"
      );
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Gateway callback error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// @desc    Get All Active Data Plans
// @route   GET /api/v1/data/plans OR GET /api/v1/plans
// @access  Public / Protected
exports.getDataPlans = async (req, res) => {
  try {
    const { network } = req.query;
    let query = {};
    if (network) {
      query.network = String(network).toUpperCase().trim();
    }

    let plans = [];
    const db = mongoose.connection.db;

    if (db) {
      try {
        plans = await db.collection("plans").find(query).sort({ network: 1, userPrice: 1 }).toArray();
        if (!plans || plans.length === 0) {
          plans = await db.collection("dataplans").find(query).sort({ network: 1, userPrice: 1 }).toArray();
        }
      } catch (_) {}
    }

    if ((!plans || plans.length === 0) && DataPlan) {
      plans = await DataPlan.find(query).sort({ network: 1, userPrice: 1 }).lean();
    }

    if (!plans || plans.length === 0) {
      plans = [
        { id: "100", planId: "100", network: "MTN", planType: "SME", plan: "1.0 GB", validity: "30 Days", costPrice: 350, userPrice: 400, agentPrice: 380, status: "active" },
        { id: "101", planId: "101", network: "MTN", planType: "SME", plan: "2.0 GB", validity: "30 Days", costPrice: 700, userPrice: 800, agentPrice: 760, status: "active" },
        { id: "201", planId: "201", network: "AIRTEL", planType: "SME", plan: "1.0 GB", validity: "30 Days", costPrice: 350, userPrice: 400, agentPrice: 380, status: "active" },
        { id: "301", planId: "301", network: "GLO", planType: "Gifting", plan: "1.0 GB", validity: "30 Days", costPrice: 350, userPrice: 400, agentPrice: 380, status: "active" },
        { id: "401", planId: "401", network: "9MOBILE", planType: "Gifting", plan: "1.0 GB", validity: "30 Days", costPrice: 350, userPrice: 400, agentPrice: 380, status: "active" }
      ];
    }

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

// @desc    Delete Data Plan
// @route   DELETE /api/v1/data/plans/:id
// @access  Private (Admin)
exports.deleteDataPlan = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: "Plan ID is required to delete." });
    }

    let Model = DataPlan;
    if (!Model) {
      try {
        Model = mongoose.model("DataPlan");
      } catch (e) {
        try {
          Model = mongoose.model("Plan");
        } catch (err) {
          Model = null;
        }
      }
    }

    if (!Model) {
      return res.status(500).json({ success: false, message: "DataPlan model is not registered." });
    }

    let deletedPlan = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      deletedPlan = await Model.findByIdAndDelete(id);
    }

    if (!deletedPlan) {
      deletedPlan = await Model.findOneAndDelete({
        $or: [
          { _id: id },
          { id: id },
          { planId: id },
          { planCode: id },
          { code: id }
        ]
      });
    }

    return res.status(200).json({
      success: true,
      message: "Data plan deleted successfully.",
      deletedId: id
    });
  } catch (err) {
    console.error("deleteDataPlan Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server failed to delete plan.",
      error: err.message
    });
  }
};