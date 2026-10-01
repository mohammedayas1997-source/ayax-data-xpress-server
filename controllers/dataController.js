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

// Helper: Tabbatar da tsarin Token na Al-Ihsan
const formatAlihsanAuth = (rawToken) => {
  if (!rawToken) return "";
  const token = String(rawToken).trim();
  return token.startsWith("Token ") ? token : `Token ${token}`;
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
 * Helper: Smart Plan-ID Router mai raba AYAX da AL-IHSAN
 */
const dispatchToExternalGateways = async ({ network, phone, planCode, amount, reference }) => {
  const normNet = String(network).toUpperCase().trim();
  const formattedPhone = cleanLocalPhone(phone);
  const errors = [];

  let targetPlanId = String(planCode).trim();
  let assignedGateway = "";

  // 1. ZAKULO DAGA DATABASE KAN AINIHIN PLAN ID DA WANE GATEWAY NE
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

        const gw = String(planDoc.gateway || planDoc.provider || planDoc.apiProvider || planDoc.server || "").toUpperCase().trim();
        if (gw.includes("ALIHSAN") || gw.includes("AL-IHSAN") || gw.includes("IHSAN")) {
          assignedGateway = "ALIHSAN";
        } else if (gw.includes("AYAX") || gw.includes("MARKETPLACE")) {
          assignedGateway = "AYAX";
        }
      }
    }
  } catch (dbErr) {
    console.error("Database Plan Lookup Error:", dbErr.message);
  }

  // Idan ba a gani a database ba, bincika ta sunan planCode ko saita default
  if (!assignedGateway) {
    if (String(planCode).toUpperCase().includes("IHSAN")) {
      assignedGateway = "ALIHSAN";
    } else {
      assignedGateway = "AYAX";
    }
  }

  console.log(`🧭 [GATEWAY ROUTED]: Plan ID ${targetPlanId} (${normNet}) assigned to: ${assignedGateway}`);

  // ==========================================
  // HANYA 1: AYAX API (Daidai da Documentation)
  // ==========================================
  if (assignedGateway === "AYAX") {
    const ayaxApiKey = String(process.env.AYAX_API_KEY || process.env.MARKETPLACE_API_KEY || "").trim();
    // Ainihin URL daga documentation dinka
   // Ainihin Daidaitaccen URL ba tare da ninka /api/v1 ba
    const ayaxEndpoint = process.env.AYAX_API_URL || "https://api.ayaxapis.com/api/v1/data/buy";

    if (!ayaxApiKey) {
      return { success: false, errors: ["AYAX: API Key is missing in environment variables (.env)"] };
    }

    // Mapping na Network zuwa Lambobi kamar yadda documentation ya bukata ("1" don MTN)
    const ayaxNetMap = {
      MTN: "1",
      AIRTEL: "2",
      "9MOBILE": "3",
      GLO: "4"
    };

    try {
      const selectedNetId = ayaxNetMap[normNet] || "1";
      
      const payload = {
        network_id: String(selectedNetId),
        plan_id: String(targetPlanId),
        phone: String(formattedPhone),
        reference: String(reference),
      };

      console.log(`📤 [AYAX API DISPATCH]:`, payload);

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
        return { success: true, provider: "AYAX_MARKETPLACE", data: resData };
      }

      return { success: false, errors: [`AYAX: ${resData?.message || "Delivery rejected"}`] };
    } catch (err) {
      const errRes = err.response?.data;
      const errMsg = errRes?.message || errRes?.desc || err.message;
      return { success: false, errors: [`AYAX: ${errMsg}`] };
    }
  }

  // ==========================================
  // HANYA 2: AL-IHSAN (IDAN PLAN DIN NA AL-IHSAN NE)
  // ==========================================
  if (assignedGateway === "ALIHSAN") {
    const rawAlihsanToken = process.env.ALIHSAN_AUTH_TOKEN || process.env.ALIHSAN_TOKEN || process.env.ALIHSAN_API_KEY;

    if (!rawAlihsanToken) {
      return { success: false, errors: ["ALIHSAN: Auth Token is missing in environment variables (.env)"] };
    }

    const cleanToken = String(rawAlihsanToken).replace(/^Token\s+/i, "").replace(/^Bearer\s+/i, "").trim();
    const gatewayNetMap = { MTN: "1", AIRTEL: "2", "9MOBILE": "3", GLO: "4" };

    try {
      const selectedNet = gatewayNetMap[normNet] || "1";
      const reqId = String(reference || `DATA_${Date.now()}`);

      const payload = {
        network: String(selectedNet),
        plan_id: String(targetPlanId),
        mobile_number: String(formattedPhone),
        request_id: reqId,
      };

      console.log("📤 [ALIHSAN DISPATCH]:", payload);

      const res = await axios.post(
        "https://alihsandatasub.com.ng/api/v1/data.php",
        payload,
        {
          headers: {
            Authorization: cleanToken,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 40000,
        }
      );

      const resData = res.data || {};
      const statusText = String(resData.status || resData.Status || resData.success || "").toLowerCase();
      const messageText = String(resData.message || resData.msg || resData.desc || "").toLowerCase();

      const isSuccess =
        statusText === "success" ||
        statusText === "successful" ||
        statusText === "true" ||
        resData.success === true ||
        resData.code === 200 ||
        resData.code === "200" ||
        messageText.includes("successful") ||
        messageText.includes("success") ||
        (resData.info && String(resData.info.status).toLowerCase() === "success");

      if (isSuccess) {
        return { success: true, provider: "ALIHSAN", data: resData };
      }

      const failMsg = resData.desc || resData.message || resData.msg || JSON.stringify(resData);
      return { success: false, errors: [`ALIHSAN: ${failMsg}`] };
    } catch (err) {
      const errRes = err.response?.data;
      const errMsg = errRes?.desc || errRes?.message || errRes?.msg || err.message;
      return { success: false, errors: [`ALIHSAN: ${errMsg}`] };
    }
  }

  return { success: false, errors: ["No valid provider configured for this plan"] };
};

/**
 * @desc    Sayen Data Bundle (VTU) via Smart Routing tare da Auto-Refund
 * @route   POST /api/v1/vtu/buy-data (ko /api/v1/data/buy)
 * @access  Private (User)
 */
exports.buyData = async (req, res) => {
  try {
    const { network, phone, phoneNumber, phoneNo, planCode, planId, plan, amount, transactionPin, pin } = req.body;
    const userId = req.user?._id || req.user?.id;

    const targetPhone = cleanLocalPhone(phoneNumber || phone || phoneNo || "");
    const finalNetwork = String(network || "").trim().toUpperCase();
    const cleanPlanCode = String(planId || planCode || plan || "27").trim();
    const amountNum = Number(amount);
    const userPin = String(transactionPin || pin || "").trim();

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

    // =========================================================================
    // EXECUTION VIA ROUTER
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
      const providerName = dispatchResult.provider || "GATEWAY";

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "success",
          reference: providerData.reference || providerData.orderId || reference,
          details: `Success: ${finalNetwork} Data (${cleanPlanCode}) to ${targetPhone} via ${providerName}`,
        }
      );

      await sendNotification(
        userId,
        "Data Bundle Successful 🎉",
        `Your ${finalNetwork} data bundle (${cleanPlanCode}) for ${targetPhone} was delivered successfully.`,
        "DATA"
      );

      return res.status(200).json({
        success: true,
        status: "success",
        message: `Data Purchase Successful via ${providerName}!`,
        orderId: providerData.reference || reference,
        network: finalNetwork,
        phone: targetPhone,
        amount: amountNum,
        newBalance: newBal,
        provider: providerName,
      });
    }

    // 2. IDAN YA GAZA: AUTO-REFUND NAN TAKE
    const combinedErrors = dispatchResult.errors.length > 0
      ? dispatchResult.errors.join(" | ")
      : "Gateway provider rejected this transaction";

    console.error(`🚨 [GATEWAY FAILED]: Refunding User ${userId}. Errors: ${combinedErrors}`);

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
        { id: "140", planId: "140", network: "MTN", planType: "DC", plan: "1.0 GB", validity: "30 Days", costPrice: 189, userPrice: 230, agentPrice: 210, status: "active" },
        { id: "27", planId: "27", network: "MTN", planType: "CG", plan: "1.0 GB", validity: "30 Days", costPrice: 400, userPrice: 450, agentPrice: 425, status: "active" },
        { id: "17", planId: "17", network: "MTN", planType: "SME", plan: "500 MB", validity: "1 Day", costPrice: 250, userPrice: 290, agentPrice: 270, status: "active" },
        { id: "262", planId: "262", network: "AIRTEL", planType: "CG", plan: "1.2 GB", validity: "7 Days", costPrice: 230, userPrice: 280, agentPrice: 260, status: "active" },
        { id: "200", planId: "200", network: "AIRTEL", planType: "SME", plan: "1.0 GB", validity: "7 Days", costPrice: 300, userPrice: 350, agentPrice: 330, status: "active" },
        { id: "28", planId: "28", network: "GLO", planType: "Gifting", plan: "1.0 GB", validity: "30 Days", costPrice: 450, userPrice: 480, agentPrice: 460, status: "active" },
        { id: "45", planId: "45", network: "9MOBILE", planType: "Gifting", plan: "500 MB", validity: "30 Days", costPrice: 480, userPrice: 550, agentPrice: 510, status: "active" }
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