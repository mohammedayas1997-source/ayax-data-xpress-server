const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");
const DataPlan = require("../models/DataPlan");
const Sale = require("../models/Sale");
const NIMCRequest = require("../models/NIMCRequest");
const axios = require("axios");

// Shigo da babban controller na Airtime
const airtimeController = require("./airtimeController");

// 1. API Credentials & Base URL Normalization
const AYAX_API_BASE_URL = (
  process.env.AYAX_API_BASE_URL ||
  process.env.MARKETPLACE_API_URL ||
  "https://ayax-api-marketplace.onrender.com"
).replace(/\/+$/, "").replace(/\/api\/v1$/, "");

const AYAX_API_KEY = (
  process.env.AYAX_API_KEY ||
  process.env.MARKETPLACE_API_KEY ||
  "ayax_live_015fd7b99f466623b4affa209f074735d9c5598d41f9a118484f0b9c5d3f8ce5"
).trim();

// Helper function to build headers
const getMarketplaceHeaders = (userAuthHeader) => {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "x-api-key": AYAX_API_KEY,
    "Authorization": `Bearer ${AYAX_API_KEY}`,
  };
};

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

/**
 * @desc    Purchase Mobile Airtime
 * @route   POST /api/v1/vtu/buy-airtime, POST /api/v1/airtime
 * @access  Private
 */
exports.buyAirtime = async (req, res) => {
  return airtimeController.buyAirtime(req, res);
};

/**
 * @desc    Purchase Mobile Data (Direct Bypass & Forwarding to AYAX API Gateway)
 * @route   POST /api/v1/vtu/buy-data, POST /api/v1/data
 * @access  Private
 */
exports.buyData = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { network, phoneNumber, phone, planCode, planSize, planId, plan, amount, pin, transactionPin } = req.body;
    
    const targetPhone = cleanLocalPhone(phoneNumber || phone || "");
    const amountNum = Number(amount) || 400;

    // 1. Tabbatar da ainihin Plan ID ba tare da an bata shi zuwa 1000MB ba
    let targetPlanId = String(planId || planCode || plan || planSize || "100").trim();

    // Duba cikin Database idan akwai cikakken Plan Document
    try {
      const planDoc = await DataPlan.findOne({
        $or: [
          { planId: targetPlanId },
          { id: targetPlanId },
          { planCode: targetPlanId }
        ]
      });
      if (planDoc) {
        targetPlanId = String(planDoc.planId || planDoc.id || targetPlanId).trim();
      }
    } catch (_) {}

    // 2. Auto-Network Resolver bisa tsarin lambobin Plan ID
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

    const netMap = { MTN: "1", AIRTEL: "2", "9MOBILE": "3", GLO: "4" };
    const finalNetId = netMap[String(network || "").toUpperCase()] || autoNetId;
    const finalNetwork = String(network || autoNetName).toUpperCase().trim();

    if (!targetPhone || targetPhone.length < 10) {
      return res.status(400).json({
        success: false,
        message: "A valid recipient phone number is required.",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < amountNum) {
      return res.status(400).json({
        success: false,
        message: `Insufficient Wallet Balance. Required: ₦${amountNum.toLocaleString()}, Available: ₦${currentBal.toLocaleString()}.`,
      });
    }

    const newBal = Number((currentBal - amountNum).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save().catch(() => {});

    const reference = `AYAX-DATA-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const transactionId = `DATA${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // Ajiye Transaction Record a Database
    await Transaction.create({
      user: user._id,
      transactionId,
      reference,
      type: "data",
      category: "data",
      amount: amountNum,
      oldBalance: currentBal,
      newBalance: newBal,
      phoneNumber: targetPhone,
      status: "pending",
      details: `${finalNetwork} (Plan ID: ${targetPlanId}) Data for ${targetPhone}`,
    }).catch(() => {});

    // 3. Cikakken Payload daidai da tsarin AYAX API Documentation
    const ayaxEndpoint = `${AYAX_API_BASE_URL}/api/v1/data/buy`;
    const dataPayload = {
      network_id: String(finalNetId),
      network: String(finalNetId),
      plan_id: String(targetPlanId),
      plan: String(targetPlanId),
      planCode: String(targetPlanId),
      phone: String(targetPhone),
      phoneNumber: String(targetPhone),
      reference: String(reference),
      amount: amountNum,
    };

    const dataHeaders = getMarketplaceHeaders(req.headers.authorization);

    console.log("------------------------------------------");
    console.log(`📤 [VTU CONTROLLER -> AYAX API]: ${ayaxEndpoint}`);
    console.log(`📤 [PAYLOAD]:`, JSON.stringify(dataPayload));
    console.log("------------------------------------------");

    try {
      const response = await axios.post(
        ayaxEndpoint,
        dataPayload,
        { headers: dataHeaders, timeout: 45000 }
      );

      console.log("📥 [AYAX API RESPONSE]:", response.data);

      const resData = response.data;
      const statusText = String(resData?.status || "").toUpperCase();

      if (
        resData?.success === true ||
        statusText === "SUCCESSFUL" ||
        statusText === "SUCCESS" ||
        response.status === 200
      ) {
        await Transaction.findOneAndUpdate(
          { reference },
          {
            status: "success",
            details: `Success: ${finalNetwork} Data (Plan ${targetPlanId}) to ${targetPhone} via AYAX API`,
          }
        ).catch(() => {});

        return res.status(200).json({
          success: true,
          status: "success",
          message: "Data purchase dispatched successfully via AYAX API.",
          data: {
            transactionId,
            reference,
            newBalance: user.walletBalance,
            providerResult: resData,
          },
        });
      } else {
        throw new Error(resData?.message || "Delivery rejected by AYAX API");
      }
    } catch (apiError) {
      const errRes = apiError.response?.data;
      const errMsg = errRes?.message || errRes?.desc || (typeof errRes === "string" ? errRes : apiError.message);
      console.error("❌ [AYAX API DISPATCH ERROR]:", errMsg);

      // Auto-Refund nan take idan kiran ya fadi
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + amountNum).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save().catch(() => {});
      }

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "failed",
          details: `Failed: ${errMsg} (Refunded ₦${amountNum})`,
        }
      ).catch(() => {});

      return res.status(422).json({
        success: false,
        status: "failed",
        refunded: true,
        message: `Delivery Error (AYAX: ${errMsg}). ₦${amountNum} has been refunded back to your wallet.`,
        newBalance: refundUser ? refundUser.walletBalance : currentBal,
      });
    }
  } catch (error) {
    console.error("Critical Data Purchase Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server encountered an error processing data.",
      error: error.message,
    });
  }
};

/**
 * @desc    NIMC Identity Validation via Ayax APIs
 * @route   POST /api/v1/vtu/nimc-validation
 * @access  Private
 */
exports.nimcValidation = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const { nin } = req.body;
    const userId = req.user?._id || req.user?.id;

    if (!nin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Please provide NIN." });
    }

    const cost = 1000;
    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);

    if (currentBal < cost) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Insufficient balance (₦1,000 required, Available: ₦${currentBal}).`,
      });
    }

    const transactionId = `NIMC${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const reference = `AYAX-NIMC-${Date.now()}`;

    const newBal = Number((currentBal - cost).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save({ session });

    await session.commitTransaction();
    session.endSession();

    let response;
    try {
      response = await axios.post(
        `${AYAX_API_BASE_URL}/api/v1/verification/nimc`,
        { nin, ref_id: reference },
        {
          headers: getMarketplaceHeaders(req.headers.authorization),
          timeout: 40000,
        }
      );
    } catch (apiError) {
      console.error("NIMC API Error:", apiError.response?.data || apiError.message);

      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + cost).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      return res.status(502).json({
        success: false,
        message: "Failed to connect to NIMC verification gateway. Money refunded.",
      });
    }

    const resData = response.data;
    if (
      resData &&
      (resData.status === true ||
        resData.status === "success" ||
        resData.code === 200 ||
        resData.code === "200")
    ) {
      const slipDetails = resData.data || resData.slip_details;

      await NIMCRequest.create({
        user: user._id,
        ninNumber: nin,
        transactionId,
        reference,
        status: "completed",
        amount: cost,
        details: slipDetails,
      });

      await Transaction.create({
        user: user._id,
        transactionId,
        reference,
        type: "nimc_validation",
        category: "identity",
        amount: cost,
        oldBalance: currentBal,
        newBalance: newBal,
        status: "success",
        details: { nin, service: "Ayax NIMC Verification" },
      });

      return res.status(200).json({
        success: true,
        data: slipDetails,
        newBalance: user.walletBalance,
      });
    } else {
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + cost).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      return res.status(400).json({
        success: false,
        message: resData?.message || "NIMC Verification Failed. Money refunded.",
      });
    }
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("NIMC Validation Error:", error);
    return res.status(500).json({
      success: false,
      message: "NIMC service error",
      error: error.message,
    });
  }
};

/**
 * @desc    Get Transaction History for Logged-in User
 * @route   GET /api/v1/vtu/transactions
 * @access  Private
 */
exports.getTransactionHistory = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const transactions = await Transaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactions,
    });
  } catch (error) {
    console.error("Get Transaction History Error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not fetch history.",
      error: error.message,
    });
  }
};

/**
 * @desc    Get Transaction Status by Reference
 * @route   GET /api/v1/vtu/transaction-status/:reference, GET /api/v1/vtu/status/:reference
 * @access  Private
 */
exports.getTransactionStatus = async (req, res) => {
  try {
    const { reference } = req.params;
    const transaction = await Transaction.findOne({
      $or: [{ reference }, { transactionId: reference }],
    }).lean();

    if (!transaction) {
      return res.status(404).json({ success: false, message: "Transaction not found." });
    }

    return res.status(200).json({
      success: true,
      status: transaction.status,
      data: transaction,
    });
  } catch (error) {
    console.error("Get Transaction Status Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Utility Placeholders (Electricity & Cable TV)
exports.verifyMeter = async (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Meter verification placeholder",
    customerName: "Test Customer",
  });
};

exports.purchaseElectricity = async (req, res) => {
  return res.status(400).json({
    success: false,
    message: "Electricity purchase service is temporarily unavailable.",
  });
};

exports.verifySmartCard = async (req, res) => {
  return res.status(200).json({
    success: true,
    message: "SmartCard verification placeholder",
    customerName: "Test Customer",
  });
};

exports.purchaseCable = async (req, res) => {
  return res.status(400).json({
    success: false,
    message: "Cable TV purchase service is temporarily unavailable.",
  });
};