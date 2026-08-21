const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");
const DataPlan = require("../models/DataPlan");
const Sale = require("../models/Sale");
const NIMCRequest = require("../models/NIMCRequest");
const axios = require("axios");

// 1. API Base URL Normalization
const RAW_URL =
  process.env.MARKETPLACE_API_URL ||
  process.env.AYAX_API_BASE_URL ||
  "https://ayax-api-marketplace.onrender.com";

const CLEAN_BASE = RAW_URL.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
const AYAX_API_BASE_URL = `${CLEAN_BASE}/api/v1`;

const AYAX_API_KEY =
  process.env.AYAX_API_KEY ||
  process.env.MARKETPLACE_API_KEY ||
  "ayax_live_13e936ef28c32f2b9d99f2974949e411608490dc069de75ad06f165251eb5345";

// Helper function to build headers
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
 * @desc    Purchase Mobile Airtime via Ayax APIs (With Safe Balance & Auto-Refund)
 * @route   POST /api/v1/vtu/buy-airtime, POST /api/v1/airtime
 * @access  Private
 */
exports.buyAirtime = async (req, res) => {
  const userId = req.user?._id || req.user?.id;
  const { network, phoneNumber, phone, amount, pin } = req.body;
  const targetPhone = phoneNumber || phone;
  const amountNum = Number(amount);

  let isDeducted = false;
  let reference = `AIR-${Date.now()}`;
  let transactionDoc = null;

  try {
    if (!network || !targetPhone || !amountNum || amountNum <= 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid network, phone number, and amount.",
      });
    }

    // 1. Verify User
    const user = await User.findById(userId).select("+transactionPin +pin +walletBalance balance");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    // 2. Validate PIN
    if (pin) {
      let isPinValid = false;
      if (user.matchPin) {
        isPinValid = await user.matchPin(pin);
      } else if (user.transactionPin) {
        isPinValid = String(user.transactionPin) === String(pin);
      } else if (user.pin) {
        isPinValid = String(user.pin) === String(pin);
      } else {
        isPinValid = pin === "0000";
      }

      if (!isPinValid) {
        return res.status(400).json({
          success: false,
          message: "Security Error: Invalid Transaction PIN.",
        });
      }
    }

    // 3. Check Wallet Balance
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < amountNum) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Required: ₦${amountNum}, Available: ₦${currentBal}`,
      });
    }

    // 4. Deduct Balance (Atomic step)
    const newBal = Number((currentBal - amountNum).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save();
    isDeducted = true;

    // 5. Create Pending Transaction Record
    const transactionId = `AIR${Date.now()}${Math.floor(Math.random() * 1000)}`;
    transactionDoc = await Transaction.create({
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

    // 6. Call Ayax API Marketplace Gateway
    const airtimePayload = {
      network: String(network).toUpperCase(),
      amount: amountNum,
      phone: targetPhone,
      phoneNumber: targetPhone,
      ref_id: reference,
      reference: reference,
    };

    const airtimeHeaders = getMarketplaceHeaders(req.headers.authorization);

    const response = await axios.post(
      `${AYAX_API_BASE_URL}/airtime/buy`,
      airtimePayload,
      { headers: airtimeHeaders, timeout: 40000 }
    );

    const resData = response?.data;
    const isSuccessful =
      resData &&
      (resData.success === true ||
        resData.status === true ||
        resData.status === "success" ||
        resData.code === 200 ||
        resData.code === "200");

    if (isSuccessful) {
      if (transactionDoc) {
        await Transaction.findByIdAndUpdate(transactionDoc._id, {
          status: "success",
          details: `Success: ₦${amountNum} airtime sent to ${targetPhone}`,
        });
      }

      return res.status(200).json({
        success: true,
        message: "Airtime purchase successful.",
        data: {
          transactionId: transactionDoc ? transactionDoc.transactionId : transactionId,
          newBalance: user.walletBalance,
        },
      });
    } else {
      throw new Error(resData?.message || "Marketplace gateway declined the transaction.");
    }
  } catch (error) {
    console.error("Airtime Purchase Error:", error.response?.data || error.message);

    // AUTO-REFUND ON FAILURE
    if (isDeducted && userId) {
      try {
        const refundUser = await User.findById(userId);
        if (refundUser) {
          refundUser.walletBalance = Number((refundUser.walletBalance + amountNum).toFixed(2));
          if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
          await refundUser.save();
        }

        if (transactionDoc) {
          await Transaction.findByIdAndUpdate(transactionDoc._id, {
            status: "failed",
            refundReason: error.message,
            details: `Failed & Refunded: ${error.message}`,
          });
        }
      } catch (refundErr) {
        console.error("Refund processing failed:", refundErr.message);
      }
    }

    return res.status(400).json({
      success: false,
      message: error.response?.data?.message || error.message || "Airtime processing failed.",
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
        `${AYAX_API_BASE_URL}/verification/nimc`,
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