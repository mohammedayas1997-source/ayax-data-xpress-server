const ValidationRequest = require("../models/ValidationRequest");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const axios = require("axios");

// 1. Tabbatar da Ingantaccen URL ba tare da maimaita /api/v1 ba
const RAW_URL =
  process.env.AYAX_API_BASE_URL ||
  process.env.MARKETPLACE_API_URL ||
  "https://ayax-api-marketplace.onrender.com";

const CLEAN_BASE = RAW_URL.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
const AYAX_API_BASE_URL = `${CLEAN_BASE}/api/v1`;

const AYAX_API_KEY =
  process.env.AYAX_API_KEY ||
  process.env.MARKETPLACE_API_KEY ||
  "ayax_live_13e936ef28c32f2b9d99f2974949e411608490dc069de75ad06f165251eb5345";

// @desc    User submits a new Validation request via Ayax APIs
// @route   POST /api/v1/validation/submit
// @access  Private
exports.submitValidation = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const { type, nin, pin, amount, formData } = req.body;
    const userId = req.user ? req.user._id || req.user.id : req.body.userId;

    if (!type || !nin || !pin || amount === undefined || !userId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields (type, nin, pin, amount)",
      });
    }

    const user = await User.findById(userId)
      .select("+pin +walletBalance balance")
      .session(session);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 1. Transaction PIN Verification
    let isPinValid = false;
    if (user.matchPin) {
      isPinValid = await user.matchPin(pin);
    } else if (user.pin) {
      isPinValid = String(user.pin) === String(pin);
    } else {
      isPinValid = pin === "0000";
    }

    if (!isPinValid) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Security Error: Invalid Transaction PIN",
      });
    }

    // 2. Duba Balance
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    const amountNum = Number(amount);

    if (currentBal < amountNum) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Kudinka bai isa ba! Required: ₦${amountNum}, Available: ₦${currentBal}`,
      });
    }

    const transactionId = `VAL${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const reference = `AYAX-VAL-${Date.now()}`;

    // 3. Cire kudi (Atomic Update)
    const newBal = Number((currentBal - amountNum).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) {
      user.balance = newBal;
    }
    await user.save({ session });

    // 4. Ajiye Transaction
    const transaction = new Transaction({
      user: userId,
      transactionId,
      reference,
      amount: amountNum,
      oldBalance: currentBal,
      newBalance: newBal,
      type: "validation_service",
      category: "identity",
      details: `Payment for Validation Service (${type})`,
      status: "pending",
    });
    await transaction.save({ session });

    // 5. Ajiye Validation Request
    const newRequest = new ValidationRequest({
      user: userId,
      userId,
      type,
      nin: String(nin).trim(),
      amount: amountNum,
      status: "pending",
      transactionId,
      reference,
      formData: formData || {},
    });
    await newRequest.save({ session });

    await session.commitTransaction();
    session.endSession();

    // 6. Kira Ayax APIs Verification Gateway tare da Dynamic Headers
    let response;
    const requestPayload = {
      type,
      nin: String(nin).trim(),
      reference,
      ref_id: reference,
      amount: amountNum,
      formData: formData || {},
    };

    const requestHeaders = {
      "Content-Type": "application/json",
      "x-api-key": AYAX_API_KEY,
      Authorization: `Bearer ${AYAX_API_KEY}`,
    };

    try {
      response = await axios.post(
        `${AYAX_API_BASE_URL}/identity/validation/process`,
        requestPayload,
        {
          headers: requestHeaders,
          timeout: 40000,
        }
      );
    } catch (apiError) {
      console.error(
        "Ayax Validation API Error:",
        apiError.response?.status,
        apiError.response?.data || apiError.message
      );

      // Auto Refund idan kiran ya gaza
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number(
          (refundUser.walletBalance + amountNum).toFixed(2)
        );
        if (refundUser.balance !== undefined)
          refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      const errMsg =
        apiError.response?.data?.message || "Gateway connection error";

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "failed",
          refundReason: errMsg,
          details: `Failed & Refunded: ${errMsg}`,
        }
      );

      await ValidationRequest.findOneAndUpdate(
        { reference },
        { status: "failed" }
      );

      return res.status(502).json({
        success: false,
        message: `Failed to connect to Ayax verification gateway (${errMsg}). Your money has been refunded.`,
      });
    }

    const resData = response.data;
    const isSuccessful =
      resData &&
      (resData.success === true ||
        resData.status === "success" ||
        resData.status === true ||
        resData.code === 200 ||
        resData.code === "200");

    if (isSuccessful) {
      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "success",
          details: `Success: Validation completed for ${type}`,
        }
      );

      await ValidationRequest.findOneAndUpdate(
        { reference },
        { status: "completed", responseDetails: resData.data || resData }
      );

      await Activity.create({
        staffId: userId,
        action: "VALIDATION_REQUEST_COMPLETED",
        details: `Successfully processed validation for ${type} (NIN: ${nin}) worth ₦${amountNum}`,
        targetUser: userId,
      });

      return res.status(200).json({
        success: true,
        message: "An sarrafa buƙatarku cikin nasara",
        data: {
          request: newRequest,
          providerResponse: resData.data || resData,
        },
        newBalance: user.walletBalance,
      });
    } else {
      // Auto Refund idan Gateway ta ki karba
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number(
          (refundUser.walletBalance + amountNum).toFixed(2)
        );
        if (refundUser.balance !== undefined)
          refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "failed",
          refundReason: resData?.message || "Provider declined",
        }
      );

      await ValidationRequest.findOneAndUpdate(
        { reference },
        { status: "failed" }
      );

      return res.status(400).json({
        success: false,
        message:
          resData?.message ||
          "Ayax validation service declined the request. Money refunded.",
      });
    }
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("Submit Validation Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while processing validation request",
      error: error.message,
    });
  }
};

// @desc    Admin fetches all validation requests
// @route   GET /api/v1/validation/admin/all
// @access  Private (Admin)
exports.getAllValidationRequests = async (req, res) => {
  try {
    const requests = await ValidationRequest.find()
      .populate("user", "surname firstName name email phone")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (error) {
    console.error("Get All Validation Requests Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};