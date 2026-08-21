const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");
const DataPlan = require("../models/DataPlan");
const Sale = require("../models/Sale");
const NIMCRequest = require("../models/NIMCRequest");
const axios = require("axios");

// 1. Saitin Babban URL na API Marketplace
const MARKETPLACE_RAW_URL =
  process.env.MARKETPLACE_API_URL ||
  process.env.AYAX_API_BASE_URL ||
  "https://ayax-api-marketplace.onrender.com";

const AYAX_API_BASE_URL = MARKETPLACE_RAW_URL.replace(/\/+$/, "");
const AYAX_API_KEY =
  process.env.AYAX_API_KEY ||
  process.env.MARKETPLACE_API_KEY ||
  "ayax_live_13e936ef28c32f2b9d99f2974949e411608490dc069de75ad06f165251eb5345";

// Helper don hada ingantattun headers
const getMarketplaceHeaders = (userAuthHeader) => {
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": AYAX_API_KEY,
  };
  if (userAuthHeader) {
    headers["Authorization"] = userAuthHeader;
  } else if (AYAX_API_KEY) {
    headers["Authorization"] = `Bearer ${AYAX_API_KEY}`;
  }
  return headers;
};

/**
 * @desc    Purchase Mobile Data with Ayax APIs & Target Tracking
 * @route   POST /api/v1/vtu/buy-data, POST /api/v1/data
 * @access  Private
 */
exports.buyData = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const { network, planId, plan, phoneNumber, phone } = req.body;
    const targetPhone = phoneNumber || phone;
    const targetPlan = planId || plan;
    const userId = req.user._id || req.user.id;

    if (!network || !targetPlan || !targetPhone) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Please provide network, planId, and phoneNumber",
      });
    }

    const [user, dataPlanDoc] = await Promise.all([
      User.findById(userId).session(session),
      DataPlan.findOne({
        $or: [
          { planCode: String(targetPlan) },
          { planId: String(targetPlan) },
          { _id: targetPlan },
        ],
      }),
    ]);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const finalPrice = dataPlanDoc
      ? user.role === "agent"
        ? dataPlanDoc.agentPrice
        : dataPlanDoc.userPrice
      : Number(req.body.amount || 0);

    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);

    if (finalPrice <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Invalid plan pricing" });
    }

    if (currentBal < finalPrice) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Required: ₦${finalPrice}, Available: ₦${currentBal}`,
      });
    }

    const transactionId = `DATA${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const reference = `AYAX-DATA-${Date.now()}`;

    // 1. Cire kudi
    const newBal = Number((currentBal - finalPrice).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save({ session });

    // 2. Ajiye Transaction
    const planLabel = dataPlanDoc?.planLabel || `${network} Data Plan`;
    const transaction = new Transaction({
      user: user._id,
      transactionId,
      reference,
      type: "data",
      category: "data",
      amount: finalPrice,
      oldBalance: currentBal,
      newBalance: newBal,
      phoneNumber: targetPhone,
      status: "pending",
      details: `Ayax Data Purchase: ${planLabel} for ${targetPhone}`,
    });
    await transaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    // 3. Kira API Gateway
    let response;
    const requestPayload = {
      network: String(network).toUpperCase(),
      plan: targetPlan,
      planId: targetPlan,
      phone: targetPhone,
      phoneNumber: targetPhone,
      amount: finalPrice,
      ref_id: reference,
      reference: reference,
    };

    const requestHeaders = getMarketplaceHeaders(req.headers.authorization);

    try {
      try {
        response = await axios.post(
          `${AYAX_API_BASE_URL}/api/v1/data/buy`,
          requestPayload,
          { headers: requestHeaders, timeout: 35000 }
        );
      } catch (err1) {
        if (err1.response?.status === 404) {
          response = await axios.post(
            `${AYAX_API_BASE_URL}/api/v1/vtu/data`,
            requestPayload,
            { headers: requestHeaders, timeout: 35000 }
          );
        } else {
          throw err1;
        }
      }
    } catch (apiError) {
      console.error("Ayax Data API Error:", apiError.response?.status, apiError.response?.data || apiError.message);

      // Refund
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + finalPrice).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      await Transaction.findOneAndUpdate(
        { reference },
        { status: "failed", refundReason: "Gateway connection error", details: "Failed & Refunded due to gateway error" }
      );

      return res.status(502).json({
        success: false,
        message: "Failed to connect to Ayax data provider. Money refunded.",
        error: apiError.response?.data?.message || apiError.message,
      });
    }

    const resData = response.data;
    const isSuccessful =
      resData &&
      (resData.status === true ||
        resData.status === "success" ||
        resData.code === 200 ||
        resData.code === "200" ||
        resData.success === true);

    if (isSuccessful) {
      await Transaction.findOneAndUpdate(
        { reference },
        { status: "success", details: `Success: ${resData.message || planLabel}` }
      );

      if (user.role === "agent" && user.assignedSupervisor) {
        await Sale.create({
          agentId: user._id,
          supervisorId: user.assignedSupervisor,
          dataAmountGB: Number(dataPlanDoc?.sizeGB) || 0,
          planName: planLabel,
          amount: finalPrice,
          transactionRef: transaction._id,
        });
      }

      await Activity.create({
  user: user._id, // <-- WANNAN SHINE FILIN DA AKE BUKATA!
  staffId: user._id,
  action: "BUY_AIRTIME",
  details: `Purchased ₦${amountNum} airtime for ${targetPhone}`,
  targetUser: user._id,
}).catch((err) => console.warn("Activity log error:", err.message));

      await Notification.create({
        recipient: user._id,
        title: "Data Purchase Successful",
        message: `Successfully sent ${planLabel} to ${targetPhone}. Amount: ₦${finalPrice}`,
        type: "vtu",
      });

      return res.status(200).json({
        success: true,
        message: `Successfully sent ${planLabel} to ${targetPhone}`,
        data: {
          transactionId: transaction.transactionId,
          newBalance: user.walletBalance,
        },
      });
    } else {
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + finalPrice).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      await Transaction.findOneAndUpdate(
        { reference },
        { status: "failed", refundReason: resData?.message || "Provider declined", details: "Declined & Refunded" }
      );

      return res.status(400).json({
        success: false,
        message: resData?.message || "Ayax data provider declined the transaction. Money refunded.",
      });
    }
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("Buy Data Internal Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal transaction error",
      error: error.message,
    });
  }
};

/**
 * @desc    Purchase Mobile Airtime via Ayax APIs
 * @route   POST /api/v1/vtu/buy-airtime, POST /api/v1/airtime
 * @access  Private
 */
exports.buyAirtime = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const { network, phoneNumber, phone, amount } = req.body;
    const targetPhone = phoneNumber || phone;
    const userId = req.user._id || req.user.id;
    const amountNum = Number(amount);

    if (!network || !targetPhone || !amountNum || amountNum <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Please provide valid network, phoneNumber, and amount",
      });
    }

    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);

    if (currentBal < amountNum) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Required: ₦${amountNum}, Available: ₦${currentBal}`,
      });
    }

    const transactionId = `AIR${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const reference = `AYAX-AIR-${Date.now()}`;

    // 1. Cire kudi a wallet
    const newBal = Number((currentBal - amountNum).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save({ session });

    const transaction = new Transaction({
      user: userId,
      transactionId,
      reference,
      type: "airtime",
      category: "airtime",
      amount: amountNum,
      oldBalance: currentBal,
      newBalance: newBal,
      phoneNumber: targetPhone,
      status: "pending",
      details: `Ayax Airtime: ₦${amountNum} for ${targetPhone}`,
    });
    await transaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    // 2. Kira API Gateway
    let response;
    const airtimePayload = {
      network: String(network).toUpperCase(),
      amount: amountNum,
      phone: targetPhone,
      phoneNumber: targetPhone,
      ref_id: reference,
      reference: reference,
    };

    const airtimeHeaders = getMarketplaceHeaders(req.headers.authorization);

    try {
      try {
        response = await axios.post(
          `${AYAX_API_BASE_URL}/api/v1/airtime/buy`,
          airtimePayload,
          { headers: airtimeHeaders, timeout: 35000 }
        );
      } catch (err1) {
        if (err1.response?.status === 404) {
          response = await axios.post(
            `${AYAX_API_BASE_URL}/api/v1/vtu/airtime`,
            airtimePayload,
            { headers: airtimeHeaders, timeout: 35000 }
          );
        } else {
          throw err1;
        }
      }
    } catch (apiError) {
      console.error("Ayax Airtime API Error:", apiError.response?.status, apiError.response?.data || apiError.message);

      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + amountNum).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      await Transaction.findOneAndUpdate(
        { reference },
        { status: "failed", refundReason: "Gateway connection error", details: "Failed & Refunded" }
      );

      return res.status(502).json({
        success: false,
        message: "Failed to connect to Ayax airtime provider. Money refunded.",
        error: apiError.response?.data?.message || apiError.message,
      });
    }

    const resData = response.data;
    const isSuccessful =
      resData &&
      (resData.status === true ||
        resData.status === "success" ||
        resData.code === 200 ||
        resData.code === "200" ||
        resData.success === true);

    if (isSuccessful) {
      await Transaction.findOneAndUpdate(
        { reference },
        { status: "success", details: `Success: ₦${amountNum} airtime sent to ${targetPhone}` }
      );

      await Activity.create({
        staffId: user._id,
        action: "BUY_AIRTIME",
        details: `Purchased ₦${amountNum} airtime for ${targetPhone}`,
        targetUser: user._id,
      });

      await Notification.create({
        recipient: user._id,
        title: "Airtime Purchase Successful",
        message: `Successfully purchased ₦${amountNum} airtime for ${targetPhone}`,
        type: "vtu",
      });

      return res.status(200).json({
        success: true,
        message: "Airtime purchase successful",
        data: { transactionId: transaction.transactionId, newBalance: user.walletBalance },
      });
    } else {
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + amountNum).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      await Transaction.findOneAndUpdate(
        { reference },
        { status: "failed", refundReason: resData?.message || "Provider declined" }
      );

      return res.status(400).json({
        success: false,
        message: resData?.message || "Ayax airtime provider error. Money refunded.",
      });
    }
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("Buy Airtime Internal Error:", error);
    return res.status(500).json({ success: false, message: "Airtime processing error", error: error.message });
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
    const userId = req.user._id || req.user.id;

    if (!nin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Please provide NIN" });
    }

    const cost = 1000;
    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);

    if (currentBal < cost) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Insufficient balance (₦1,000 required, Available: ₦${currentBal})`,
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
      console.error("Ayax NIMC API Error:", apiError.message);

      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + cost).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      return res.status(502).json({
        success: false,
        message: "Failed to connect to Ayax NIMC verification gateway. Money refunded.",
      });
    }

    const resData = response.data;
    if (resData && (resData.status === true || resData.status === "success" || resData.code === 200 || resData.code === "200")) {
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

      await Activity.create({
        staffId: user._id,
        action: "NIMC_VALIDATION",
        details: `Successfully verified NIN: ${nin}`,
        targetUser: user._id,
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
        message: resData?.message || "Ayax NIMC Verification Failed. Money refunded.",
      });
    }
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("NIMC Validation Error:", error);
    return res.status(500).json({ success: false, message: "NIMC service error", error: error.message });
  }
};

/**
 * @desc    Get Transaction History for Logged-in User
 * @route   GET /api/v1/vtu/transactions
 * @access  Private
 */
exports.getTransactionHistory = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const transactions = await Transaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.status(200).json({ success: true, count: transactions.length, data: transactions });
  } catch (error) {
    console.error("Get Transaction History Error:", error);
    return res.status(500).json({ success: false, message: "Could not fetch history", error: error.message });
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
      return res.status(404).json({ success: false, message: "Transaction not found" });
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
  return res.status(200).json({ success: true, message: "Meter verification placeholder", customerName: "Test Customer" });
};
exports.purchaseElectricity = async (req, res) => {
  return res.status(400).json({ success: false, message: "Electricity purchase logic coming soon" });
};
exports.verifySmartCard = async (req, res) => {
  return res.status(200).json({ success: true, message: "SmartCard verification placeholder", customerName: "Test Customer" });
};
exports.purchaseCable = async (req, res) => {
  return res.status(400).json({ success: false, message: "Cable purchase logic coming soon" });
};