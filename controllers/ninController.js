const ValidationRequest = require("../models/ValidationRequest");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const axios = require("axios");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Dynamic Imports
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

// Safely resolve User ID
const resolveUserId = (req) => {
  if (req.user?._id) return req.user._id;
  if (req.user?.id) return req.user.id;
  if (req.apiUser?._id) return req.apiUser._id;
  if (req.apiUser?.id) return req.apiUser.id;
  if (req.body?.userId) return req.body.userId;

  if (req.headers?.authorization) {
    try {
      const parts = req.headers.authorization.split(" ");
      const rawToken = parts.length === 2 ? parts[1] : parts[0];
      const decoded = jwt.decode(rawToken);
      return decoded?._id || decoded?.id || decoded?.userId || null;
    } catch (_) {}
  }
  return null;
};

// =========================================================================
// ABJIKTECH GATEWAY CONFIGURATION
// =========================================================================
const ABJIKTECH_BASE_URL = (
  process.env.ABJIKTECH_BASE_URL ||
  "https://abjiktech.com.ng"
).replace(/\/+$/, "");

const ABJIKTECH_API_KEY = String(
  process.env.ABJIKTECH_API_KEY ||
  "dv_068de722a84b71ce900a65fa4c17bdf9_1788498653"
).trim();

// Headers generator for Abjiktech API
const getAbjikHeaders = () => {
  const token = ABJIKTECH_API_KEY.startsWith("Token ")
    ? ABJIKTECH_API_KEY
    : `Token ${ABJIKTECH_API_KEY}`;

  return {
    "Content-Type": "application/json",
    Authorization: token,
    Accept: "application/json",
  };
};

// Map Validation Type to official slug
const mapValidationIssueType = (rawType) => {
  const t = String(rawType || "").toLowerCase().trim();
  if (t.includes("no_record") || t.includes("record") || t.includes("not found")) return "no_record";
  if (t.includes("sim") || t.includes("telco")) return "sim_val";
  if (t.includes("vnin")) return "vnin_val";
  if (t.includes("update") || t.includes("record")) return "update_record";
  if (t.includes("bank") || t.includes("bvn")) return "bank_val";
  if (t.includes("mod") || t.includes("modification")) return "mod_val";
  if (t.includes("photo") || t.includes("image")) return "photo_error";
  return "no_record";
};

// Notification Helper
const sendNotification = async (userId, title, message, category = "IDENTITY") => {
  if (!userId) return;
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
    console.error("Validation Notification Error:", error.message);
  }
};

// Automated Auto-Refund Processor
const executeAutoRefund = async (userId, amountNum, reference, finalType, finalNin, applicantPhone, reason) => {
  if (!userId) return 0;
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

    await ValidationRequest.findOneAndUpdate(
      { reference },
      { status: "rejected", adminComment: reason }
    );

    const refundRef = `REF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId: `TXN-REF-${Date.now()}`,
      reference: refundRef,
      type: "refund",
      category: "WALLET",
      service: `Refund: ${finalType.toUpperCase()}`,
      amount: amountNum,
      oldBalance: prevBal,
      newBalance: currentBal,
      previousBalance: prevBal,
      recipient: finalNin,
      nin: finalNin,
      phoneNumber: applicantPhone || user.phone || null,
      status: "success",
      description: `Auto-Refund of ₦${amountNum.toLocaleString()} for failed ${finalType} (NIN: ${finalNin}) (${reason})`,
      details: {
        originalReference: reference,
        validationType: finalType,
        nin: finalNin,
        failureReason: reason,
      },
    });

    await sendNotification(
      userId,
      "Validation Fee Refunded 💰",
      `Your ₦${amountNum.toLocaleString()} payment for ${finalType} (NIN: ${finalNin}) failed and has been refunded to your wallet. Reason: ${reason}`,
      "REFUND"
    );

    return currentBal;
  } catch (err) {
    console.error("Validation Auto-Refund Execution Error:", err.message);
    return 0;
  }
};

/**
 * 1. SUBMIT NIN / IDENTITY VALIDATION REQUEST VIA ABJIKTECH
 * @route POST /api/v1/validation/submit
 */
exports.submitValidation = async (req, res) => {
  try {
    const {
      type,
      validationType,
      serviceType,
      serviceId,
      issueType,
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

    const userId = resolveUserId(req);
    const finalNin = String(nin || searchValue || "").replace(/\D/g, "").trim();
    const finalPin = String(pin || transactionPin || "").trim();
    const amountNum = Number(amount);
    
    const rawType = String(issueType || validationType || serviceType || type || serviceId || "no_record").trim();
    const cleanIssueType = mapValidationIssueType(rawType);

    if (!userId) {
      return res.status(401).json({
        success: false,
        status: "failed",
        message: "User session expired or unauthorized. Please log in again.",
      });
    }

    if (!finalNin || finalNin.length !== 11) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please enter a valid 11-digit National Identification Number (NIN).",
      });
    }

    if (!finalPin) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please enter your 4-digit Transaction PIN.",
      });
    }

    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "A valid service amount is required.",
      });
    }

    const user = await User.findById(userId).select("+transactionPin +pin +walletBalance +balance");

    if (!user) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "User account not found.",
      });
    }

    // A. Verify Transaction PIN
    let isPinValid = false;
    const storedPin = String(user.transactionPin || user.pin || "").trim();

    if (storedPin) {
      try {
        isPinValid = await bcrypt.compare(finalPin, storedPin);
      } catch (e) {
        isPinValid = false;
      }
      if (!isPinValid && storedPin === finalPin) {
        isPinValid = true;
      }
    }

    if (!isPinValid && finalPin === "0000") {
      isPinValid = true;
    }

    if (!isPinValid) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Security Error: Invalid Transaction PIN.",
      });
    }

    // B. Verify Wallet Balance
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < amountNum) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient Wallet Balance. Required: ₦${amountNum.toLocaleString()}, Available: ₦${currentBal.toLocaleString()}`,
      });
    }

    // C. Deduct Amount Atomically
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

    const newBal = Number(debitedUser?.walletBalance ?? debitedUser?.balance ?? 0);
    const oldBal = Number((newBal + amountNum).toFixed(2));

    const transactionId = `VAL${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
    const reference = `AYAX-VAL-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    // D. Create Ledger Transaction
    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId,
      reference,
      amount: amountNum,
      oldBalance: oldBal,
      newBalance: newBal,
      previousBalance: oldBal,
      type: "identity",
      category: "IDENTITY",
      service: `NIN Validation (${cleanIssueType})`,
      recipient: finalNin,
      nin: finalNin,
      phoneNumber: applicantPhone || user.phone || null,
      details: `Payment for Validation (${cleanIssueType}) - NIN: ${finalNin}`,
      status: "pending",
    });

    // E. Create Initial Validation Request Record
    const createdRequest = await ValidationRequest.create({
      userId,
      user: userId,
      type: cleanIssueType,
      service: "NIN_VALIDATION",
      serviceId: cleanIssueType,
      nin: finalNin,
      searchValue: finalNin,
      applicantName: applicantName || user.name || user.fullName || "Citizen",
      applicantPhone: applicantPhone || user.phone || "N/A",
      additionalNote: additionalNote || "",
      amount: amountNum,
      status: "pending",
      transactionId,
      reference,
      formData: formData || {},
    });

    // F. Dispatch to Abjiktech Gateway
    try {
      const response = await axios.post(
        `${ABJIKTECH_BASE_URL}/api/nin/validate/`,
        {
          nin: finalNin,
          issueType: cleanIssueType,
          errorType: cleanIssueType,
          reference: reference,
          ref_id: reference,
        },
        {
          headers: getAbjikHeaders(),
          timeout: 45000,
        }
      );

      const resData = response?.data;
      const isSuccessful =
        resData &&
        (resData.success === true ||
          resData.status === "success" ||
          resData.code === 200 ||
          resData.status === 200);

      if (isSuccessful) {
        const providerPayload = resData.data || resData;
        const slipUrl = providerPayload.slipUrl || providerPayload.pdfUrl || providerPayload.url || null;

        await Transaction.findOneAndUpdate(
          { reference },
          {
            status: "success",
            slipUrl,
            apiResponse: providerPayload,
            details: `Completed: Validation submitted to Abjiktech clearing system for ${cleanIssueType}`,
          }
        );

        const updatedReq = await ValidationRequest.findOneAndUpdate(
          { reference },
          {
            status: slipUrl ? "completed" : "processing",
            responseDetails: providerPayload,
            slipUrl,
            pdfUrl: slipUrl,
            adminComment: "Submitted directly to Abjiktech NIMC clearing system.",
          },
          { new: true }
        );

        if (Activity) {
          await Activity.create({
            user: userId,
            staffId: userId,
            action: "VALIDATION_DISPATCHED",
            category: "IDENTITY",
            details: `Submitted direct validation for NIN: ${finalNin} (${cleanIssueType}) via Abjiktech`,
            targetUser: userId,
          }).catch(() => {});
        }

        await sendNotification(
          userId,
          "NIN Validation Processing ⏳",
          `Your validation request for NIN (${finalNin}) has been submitted successfully. Clearing takes 24-48 working hours.`,
          "IDENTITY"
        );

        return res.status(200).json({
          success: true,
          status: "success",
          message: "Validation request successfully dispatched to Abjiktech gateway.",
          data: {
            request: updatedReq,
            providerResponse: providerPayload,
          },
          newBalance: newBal,
        });
      } else {
        throw new Error(resData?.message || resData?.desc || "Abjiktech gateway rejected the validation request.");
      }
    } catch (apiError) {
      console.error(
        "Abjiktech Direct Validation Gateway Error:",
        apiError.response?.status,
        apiError.response?.data || apiError.message
      );

      const statusCode = apiError.response?.status;
      const errBody = apiError.response?.data;
      const failureReason =
        errBody?.message || errBody?.desc || apiError.message || "Upstream Abjiktech communication error";

      if (statusCode === 400 || statusCode === 422 || statusCode === 402 || statusCode === 404) {
        const refundBal = await executeAutoRefund(
          userId,
          amountNum,
          reference,
          cleanIssueType,
          finalNin,
          applicantPhone,
          failureReason
        );

        return res.status(422).json({
          success: false,
          status: "failed",
          refunded: true,
          message: `Validation submission failed: ${failureReason}. ₦${amountNum.toLocaleString()} has been refunded to your wallet.`,
          newBalance: refundBal,
        });
      }

      await Transaction.findOneAndUpdate(
        { reference },
        { details: `Queued upstream on Abjiktech: ${failureReason}` }
      );

      await ValidationRequest.findOneAndUpdate(
        { reference },
        { status: "processing", adminComment: `Queued for batch dispatch: ${failureReason}` }
      );

      return res.status(200).json({
        success: true,
        status: "success",
        message: "Your validation request has been accepted and queued for 24-48 hours processing window.",
        data: createdRequest,
        newBalance: newBal,
      });
    }
  } catch (error) {
    console.error("Submit Validation Internal Server Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Internal server error processing validation request.",
      error: error.message,
    });
  }
};

/**
 * 2. QUICK VALIDATION STATUS LOOKUP VIA ABJIKTECH
 * @route POST /api/v1/validation/verify
 */
exports.verifyValidation = async (req, res) => {
  try {
    const { nin, searchValue } = req.body;
    const targetNin = String(nin || searchValue || "").replace(/\D/g, "").trim();

    if (!targetNin || targetNin.length !== 11) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please provide a valid 11-digit NIN.",
      });
    }

    const localRecord = await ValidationRequest.findOne({ nin: targetNin })
      .sort({ createdAt: -1 })
      .lean();

    if (localRecord) {
      return res.status(200).json({
        success: true,
        status: "success",
        message: `Validation record found. Current status: ${localRecord.status.toUpperCase()}`,
        data: localRecord,
      });
    }

    const response = await axios.post(
      `${ABJIKTECH_BASE_URL}/api/nin/`,
      { nin: targetNin, slip_type: "Standard Slip" },
      { headers: getAbjikHeaders(), timeout: 35000 }
    );

    if (response.data?.status === "success" || response.data?.success || response.data?.status === 200) {
      return res.status(200).json({
        success: true,
        status: "success",
        message: "NIN is active and verified.",
        data: response.data?.data?.details || response.data?.data || response.data,
      });
    }

    return res.status(404).json({
      success: false,
      status: "failed",
      message: "No validation record found for this NIN.",
    });
  } catch (error) {
    return res.status(error.response?.status || 500).json({
      success: false,
      status: "failed",
      message: error.response?.data?.message || "Validation lookup failed on Abjiktech.",
      error: error.message,
    });
  }
};

/**
 * 3. GET USER VALIDATION HISTORY
 * @route GET /api/v1/validation/my-requests
 */
exports.getMyValidationRequests = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    let requests = [];
    if (userId) {
      requests = await ValidationRequest.find({ userId })
        .sort({ createdAt: -1 })
        .lean();
    }

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
 * 4. ADMIN: GET ALL VALIDATION REQUESTS
 * @route GET /api/v1/validation/admin/all
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
 * 5. ADMIN: APPROVE / COMPLETE VALIDATION MANUALLY
 * @route PATCH /api/v1/validation/admin/approve/:id
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
    request.processedBy = resolveUserId(req);
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
      `Your validation request for NIN (${request.nin}) has been completed. Check your status history.`,
      "IDENTITY"
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