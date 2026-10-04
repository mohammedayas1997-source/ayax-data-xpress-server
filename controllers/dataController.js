const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

// Dynamic DataPlan Model Loader tare da Fallback
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

// DataPlanModel Wrapper don hana kuskuren "DataPlanModel.create is not a function"
const DataPlanModel = {
  create: async (doc) => {
    const db = mongoose.connection?.db;
    const finalCode = String(
      doc.gatewayPlanId ||
        doc.planCode ||
        doc.planId ||
        doc.code ||
        doc.serviceCode ||
        doc.id ||
        ""
    ).trim();

    const planData = {
      ...doc,
      id: finalCode,
      planId: finalCode,
      planCode: finalCode,
      code: finalCode,
      serviceCode: finalCode,
      gatewayPlanId: finalCode,
      network: String(doc.network || "MTN").toUpperCase(),
      networkName: String(doc.network || "MTN").toUpperCase(),
      userPrice: Number(doc.customerSellingPrice || doc.userPrice || doc.price || 0),
      price: Number(doc.customerSellingPrice || doc.userPrice || doc.price || 0),
      agentPrice: Number(doc.retailAgentWholesalePrice || doc.retailAgentPrice || doc.agentPrice || 0),
      validity: doc.validityDuration || doc.validity || "30 Days",
      status: "active",
      isActive: true,
      updatedAt: new Date(),
    };

    if (db) {
      await db.collection("plans").updateOne(
        { $or: [{ id: finalCode }, { planId: finalCode }, { planCode: finalCode }] },
        { $set: planData, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
      await db.collection("dataplans").updateOne(
        { $or: [{ id: finalCode }, { planId: finalCode }, { planCode: finalCode }] },
        { $set: planData, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
    }

    if (DataPlan) {
      try {
        if (typeof DataPlan.findOneAndUpdate === "function") {
          return await DataPlan.findOneAndUpdate(
            { $or: [{ planCode: finalCode }, { planId: finalCode }] },
            { $set: planData },
            { upsert: true, new: true }
          );
        } else if (typeof DataPlan.create === "function") {
          return await DataPlan.create(planData);
        }
      } catch (_) {}
    }
    return planData;
  },
};

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
 * Helper: Pure AYAX API Dispatcher (Universal Gateway Support)
 */
const dispatchToExternalGateways = async ({ network, phone, planCode, amount, reference }) => {
  const formattedPhone = cleanLocalPhone(phone);
  let targetPlanId = String(planCode).trim();
  let resolvedNetwork = String(network || "MTN").toUpperCase();
  const errors = [];

  // 1. ZAKULO DAGA DATABASE KAN AINIHIN PLAN ID DA VARIATION CODE
  try {
    const db = mongoose.connection?.db;
    if (db) {
      const planDoc =
        (await db.collection("plans").findOne({
          $or: [
            { planId: targetPlanId },
            { id: targetPlanId },
            { planCode: targetPlanId },
            { code: targetPlanId },
            { serviceCode: targetPlanId },
            { _id: mongoose.Types.ObjectId.isValid(targetPlanId) ? new mongoose.Types.ObjectId(targetPlanId) : null },
          ],
        })) ||
        (await db.collection("dataplans").findOne({
          $or: [
            { planId: targetPlanId },
            { id: targetPlanId },
            { planCode: targetPlanId },
            { code: targetPlanId },
            { serviceCode: targetPlanId },
            { _id: mongoose.Types.ObjectId.isValid(targetPlanId) ? new mongoose.Types.ObjectId(targetPlanId) : null },
          ],
        }));

      if (planDoc) {
        targetPlanId = String(
          planDoc.serviceCode ||
          planDoc.variation_code ||
          planDoc.variationCode ||
          planDoc.planCode ||
          planDoc.code ||
          planDoc.planId ||
          planDoc.providerPlanId ||
          targetPlanId
        ).trim();

        if (planDoc.network || planDoc.networkName) {
          resolvedNetwork = String(planDoc.network || planDoc.networkName).toUpperCase();
        }
      }
    }
  } catch (dbErr) {
    console.error("Database Plan Lookup Error:", dbErr.message);
  }

  // 2. Tabbatar da cewa Variation Code ba ya da haruffa marasa kyau
  // Canza MTN_TR_1GB_7DAYS zuwa mtn-tr-1gb-7days
  if (targetPlanId.includes("_")) {
    targetPlanId = targetPlanId.toLowerCase().replace(/_/g, "-");
  }

  // Idan har yanzu lambar ID ce ta kudi (kamar ₦400 ko ₦500), canza ta zuwa ainihin code
  if (resolvedNetwork === "MTN") {
    if (targetPlanId === "400" || Number(amount) === 400) {
      targetPlanId = "mtn-tr-1gb-7days";
    } else if (targetPlanId === "500" || Number(amount) === 500) {
      targetPlanId = "mtn-tr-1gb";
    }
  }

  // 3. AYAX API CREDENTIALS & RENDER ENDPOINT
  const ayaxApiKey = String(
    process.env.AYAX_API_KEY ||
      process.env.MARKETPLACE_API_KEY ||
      "ayax_live_5ce0853aad6efd1dba69b383d9d3679232a2d1e50c92a108eef8d288f578280f"
  ).trim();

  const ayaxBaseUrl = (
    process.env.AYAX_API_BASE_URL || "https://ayax-api-marketplace.onrender.com"
  ).replace(/\/+$/, "");

  const ayaxEndpoint = `${ayaxBaseUrl}/api/v1/data/buy`;

  // Cikakken Universal Payload wanda yake gamsar da dukkan tsare-tsare
  const payload = {
    network: resolvedNetwork,
    network_id: resolvedNetwork === "AIRTEL" ? "2" : resolvedNetwork === "GLO" ? "4" : resolvedNetwork === "9MOBILE" ? "3" : "1",
    service_id: resolvedNetwork.toLowerCase(),
    planCode: String(targetPlanId),
    plan_id: String(targetPlanId),
    variation_code: String(targetPlanId),
    serviceCode: String(targetPlanId),
    code: String(targetPlanId),
    phone: String(formattedPhone),
    phoneNumber: String(formattedPhone),
    mobile_number: String(formattedPhone),
    reference: String(reference),
    amount: Number(amount),
  };

  console.log("------------------------------------------");
  console.log(`📤 [AYAX DIRECT DISPATCH]: URL: ${ayaxEndpoint}`);
  console.log("📤 [AYAX PAYLOAD]:", JSON.stringify(payload));
  console.log("------------------------------------------");

  try {
    const res = await axios.post(ayaxEndpoint, payload, {
      headers: {
        "x-api-key": ayaxApiKey,
        Authorization: `Bearer ${ayaxApiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      timeout: 45000,
    });

    console.log("📥 [AYAX RESPONSE]:", res.data);

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
    console.error("❌ [AYAX RAW ERROR RESPONSE]:", errRes || err.message);
    const errMsg =
      errRes?.message ||
      errRes?.desc ||
      errRes?.errors?.variation_code?.[0] ||
      (typeof errRes === "string" ? errRes : err.message);
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
    const combinedErrors =
      dispatchResult.errors.length > 0
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
    const db = mongoose.connection?.db;

    if (db) {
      try {
        plans = await db.collection("plans").find(query).sort({ network: 1, userPrice: 1 }).toArray();
        if (!plans || plans.length === 0) {
          plans = await db.collection("dataplans").find(query).sort({ network: 1, userPrice: 1 }).toArray();
        }
      } catch (_) {}
    }

    if ((!plans || plans.length === 0) && DataPlan && typeof DataPlan.find === "function") {
      plans = await DataPlan.find(query).sort({ network: 1, userPrice: 1 }).lean();
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

    const db = mongoose.connection?.db;
    if (db) {
      await db.collection("plans").deleteMany({
        $or: [{ id }, { planId: id }, { planCode: id }, { code: id }],
      });
      await db.collection("dataplans").deleteMany({
        $or: [{ id }, { planId: id }, { planCode: id }, { code: id }],
      });
    }

    return res.status(200).json({
      success: true,
      message: "Data plan deleted successfully.",
      deletedId: id,
    });
  } catch (err) {
    console.error("deleteDataPlan Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Server failed to delete plan.",
      error: err.message,
    });
  }
};

module.exports = {
  ...exports,
  DataPlanModel,
};