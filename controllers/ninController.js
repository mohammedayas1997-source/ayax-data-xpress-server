const ValidationRequest = require("../models/ValidationRequest");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const axios = require("axios");
const bcrypt = require("bcryptjs");

// 1. Ayax API Gateway Base Configuration
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

// Ayax Standard API Headers
const getHeaders = () => ({
  "Content-Type": "application/json",
  "x-api-key": AYAX_API_KEY,
  Authorization: `Bearer ${AYAX_API_KEY}`,
});

// Helper don tura sanarwa ga User
const sendNotification = async (userId, title, message, category = "NIN_SERVICE") => {
  try {
    const user = await User.findById(userId);
    if (user) {
      if (!user.notifications) user.notifications = [];
      user.notifications.unshift({
        title,
        message,
        category,
        date: new Date(),
        isRead: false,
      });
      await user.save();
    }
  } catch (error) {
    console.error("Validation Notification Error:", error.message);
  }
};

/**
 * 1. SUBMIT NIN / IDENTITY VALIDATION REQUEST
 * @route POST /api/v1/validation/submit (ko /api/v1/nin/validate)
 * @access Private (User)
 */
exports.submitValidation = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const {
      type,
      validationType,
      serviceId,
      nin,
      searchValue,
      pin,
      transactionPin,
      amount,
      applicantName,
      applicantPhone,
      additionalNote,
      formData,
    } = req.body;

    const userId = req.user ? req.user._id || req.user.id : req.body.userId;
    const finalType = String(validationType || type || "NIN Validation").trim();
    const finalNin = String(nin || searchValue || "").trim();
    const finalPin = String(pin || transactionPin || "").trim();
    const amountNum = Number(amount);

    if (!finalType || !finalNin || !finalPin || isNaN(amountNum) || amountNum <= 0 || !userId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please provide all required fields (validation type, 11-digit NIN, transaction PIN, and valid amount).",
      });
    }

    const user = await User.findById(userId)
      .select("+transactionPin +pin +walletBalance balance")
      .session(session);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "User account not found.",
      });
    }

    // A. Verify Transaction PIN
    let isPinValid = false;
    if (user.matchPin) {
      isPinValid = await user.matchPin(finalPin);
    } else if (user.transactionPin) {
      isPinValid = String(user.transactionPin) === String(finalPin);
    } else if (user.pin) {
      isPinValid = user.pin === finalPin || (await bcrypt.compare(String(finalPin), user.pin).catch(() => false));
    } else {
      isPinValid = finalPin === "0000";
    }

    if (!isPinValid) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Security Error: Invalid Transaction PIN.",
      });
    }

    // B. Verify Wallet Balance
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < amountNum) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient Wallet Balance. Required: ₦${amountNum.toLocaleString()}, Available: ₦${currentBal.toLocaleString()}`,
      });
    }

    const transactionId = `VAL${Date.now()}${Math.floor(Math.random() * 10000)}`;
    const reference = `AYAX-VAL-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // C. Deduct Amount Atomically
    const newBal = Number((currentBal - amountNum).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save({ session });

    // D. Create Ledger Transaction
    const transaction = new Transaction({
      user: userId,
      transactionId,
      reference,
      amount: amountNum,
      oldBalance: currentBal,
      newBalance: newBal,
      type: "nin_validation",
      category: "DEBIT",
      nin: finalNin,
      phoneNumber: applicantPhone || user.phone || null,
      details: `Payment for Validation Service (${finalType}) - NIN: ${finalNin}`,
      status: "pending",
    });
    await transaction.save({ session });

    // E. Create Initial Validation Request Record
    const newRequest = new ValidationRequest({
      userId,
      user: userId,
      type: finalType,
      service: "NIN_VALIDATION",
      serviceId: serviceId || null,
      nin: finalNin,
      searchValue: finalNin,
      applicantName: applicantName || user.name || user.fullName || "Client",
      applicantPhone: applicantPhone || user.phone || "N/A",
      additionalNote: additionalNote || "",
      amount: amountNum,
      status: "pending",
      transactionId,
      reference,
      formData: formData || {},
    });
    await newRequest.save({ session });

    await session.commitTransaction();
    session.endSession();

    // F. Dispatch Live Processing to Ayax Validation Gateway
    let response;
    const candidateEndpoints = [
      `${AYAX_API_BASE_URL}/identity/validation/process`,
      `${AYAX_API_BASE_URL}/nin/validate`,
      `${AYAX_API_BASE_URL}/identity/nin/validate`,
    ];

    try {
      for (const endpoint of candidateEndpoints) {
        try {
          response = await axios.post(
            endpoint,
            {
              type: finalType,
              serviceId,
              nin: finalNin,
              reference,
              ref_id: reference,
              amount: amountNum,
              applicantName: applicantName || user.name,
              applicantPhone: applicantPhone || user.phone,
              formData: formData || {},
            },
            {
              headers: getHeaders(),
              timeout: 45000,
            }
          );
          if (response.data) break;
        } catch (e) {
          if (endpoint === candidateEndpoints[candidateEndpoints.length - 1]) throw e;
        }
      }
    } catch (apiError) {
      console.error(
        "Ayax Validation Gateway Connection Error:",
        apiError.response?.status,
        apiError.response?.data || apiError.message
      );

      // Automated Instant Refund
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + amountNum).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      const errMsg = apiError.response?.data?.message || "Validation gateway timed out";

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "failed",
          isRefunded: true,
          refundReason: errMsg,
          details: `Failed & Refunded: ${errMsg}`,
        }
      );

      await ValidationRequest.findOneAndUpdate(
        { reference },
        { status: "failed", adminComment: errMsg }
      );

      await sendNotification(
        userId,
        "Validation Fee Refunded",
        `Your ₦${amountNum.toLocaleString()} validation request for NIN (${finalNin}) failed to connect and was refunded to your wallet.`,
        "REFUND"
      );

      return res.status(502).json({
        success: false,
        status: "failed",
        message: `Validation service unavailable (${errMsg}). ₦${amountNum.toLocaleString()} has been refunded to your wallet.`,
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
      const providerPayload = resData.data || resData;
      const slipUrl = providerPayload.slipUrl || providerPayload.pdfUrl || providerPayload.url || null;

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "success",
          slipUrl,
          apiResponse: providerPayload,
          details: `Success: Validation completed for ${finalType}`,
        }
      );

      const completedRequest = await ValidationRequest.findOneAndUpdate(
        { reference },
        {
          status: "completed",
          responseDetails: providerPayload,
          slipUrl,
          pdfUrl: slipUrl,
        },
        { new: true }
      );

      await Activity.create({
        user: userId,
        staffId: userId,
        action: "VALIDATION_REQUEST_COMPLETED",
        category: "IDENTITY",
        details: `Successfully completed validation for ${finalType} (NIN: ${finalNin}) worth ₦${amountNum}`,
        targetUser: userId,
      }).catch(() => {});

      await sendNotification(
        userId,
        "Validation Request Approved 🎉",
        `Your validation request for NIN (${finalNin}) has been successfully completed.`,
        "NIN_SERVICE"
      );

      return res.status(200).json({
        success: true,
        status: "success",
        message: "NIN Validation completed successfully via Ayax APIs.",
        data: {
          request: completedRequest,
          providerResponse: providerPayload,
        },
        newBalance: user.walletBalance,
      });
    } else {
      // Gateway Refusal & Automated Refund
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + amountNum).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      const failureReason = resData?.message || "Ayax validation provider declined request";

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "failed",
          isRefunded: true,
          refundReason: failureReason,
          details: `Declined & Refunded: ${failureReason}`,
        }
      );

      await ValidationRequest.findOneAndUpdate(
        { reference },
        { status: "failed", adminComment: failureReason }
      );

      await sendNotification(
        userId,
        "Validation Request Declined",
        `Your validation request for NIN (${finalNin}) was declined (${failureReason}). Money has been refunded.`,
        "REFUND"
      );

      return res.status(400).json({
        success: false,
        status: "failed",
        message: `${failureReason}. ₦${amountNum.toLocaleString()} has been refunded to your wallet.`,
      });
    }
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("Submit Validation Server Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Internal server error occurred while processing validation request.",
      error: error.message,
    });
  }
};

/**
 * 2. GET USER VALIDATION HISTORY
 * @route GET /api/v1/validation/my-requests
 * @access Private (User)
 */
exports.getMyValidationRequests = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const requests = await ValidationRequest.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      status: "success",
      count: requests.length,
      data: requests,
      requests,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to fetch validation history.",
      error: error.message,
    });
  }
};

/**
 * 3. ADMIN: GET ALL VALIDATION REQUESTS (DASHBOARD)
 * @route GET /api/v1/validation/admin/all
 * @access Private (Admin / Superadmin)
 */
exports.getAllValidationRequests = async (req, res) => {
  try {
    const requests = await ValidationRequest.find()
      .populate("userId", "surname firstName name fullName email phone walletBalance role")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      status: "success",
      count: requests.length,
      data: requests,
      requests,
    });
  } catch (error) {
    console.error("Get All Validation Requests Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to retrieve validation requests.",
      error: error.message,
    });
  }
};

/**
 * 4. ADMIN: APPROVE / COMPLETE VALIDATION MANUALLY
 * @route PATCH /api/v1/validation/admin/approve/:id
 * @access Private (Admin)
 */
exports.approveValidation = async (req, res) => {
  try {
    const { adminComment, slipUrl, pdfUrl } = req.body;
    const request = await ValidationRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ success: false, message: "Validation request not found." });
    }

    request.status = "completed";
    if (adminComment) request.adminComment = adminComment;
    if (slipUrl || pdfUrl) {
      request.slipUrl = slipUrl || pdfUrl;
      request.pdfUrl = pdfUrl || slipUrl;
    }
    request.processedBy = req.user._id || req.user.id;
    await request.save();

    if (request.reference) {
      await Transaction.findOneAndUpdate(
        { reference: request.reference },
        {
          status: "success",
          slipUrl: request.slipUrl,
          details: `Manual approval completed by Admin`,
        }
      );
    }

    await sendNotification(
      request.userId,
      "NIN Validation Completed 📄",
      `Your validation request for NIN (${request.nin}) has been marked as completed by administrators.`,
      "NIN_SERVICE"
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: "Validation request marked as completed.",
      data: request,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};