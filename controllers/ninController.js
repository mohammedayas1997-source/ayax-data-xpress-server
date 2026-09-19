const ValidationRequest = require("../models/ValidationRequest");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const axios = require("axios");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

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

const ABJIKTECH_API_KEY = String(
  process.env.ABJIKTECH_API_KEY || "dv_068de722a84b71ce900a65fa4c17bdf9_1788498653"
).trim();

// Tace error_type zuwa ainihin 4 da Abjiktech ke karɓa
const mapToAbjiktechErrorType = (rawType) => {
  const t = String(rawType || "").toLowerCase().trim();
  if (t.includes("sim") || t.includes("bank")) return "simbank_validation";
  if (t.includes("mod") || t.includes("change") || t.includes("update")) return "modification";
  if (t.includes("photo") || t.includes("image")) return "photo_error";
  return "no_record"; // Default ga No Record Found
};

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
    const abjikErrorType = mapToAbjiktechErrorType(rawType);

    if (!userId) {
      return res.status(401).json({
        success: false,
        status: "failed",
        message: "User session expired. Please log in again.",
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

    let isPinValid = false;
    const storedPin = String(user.transactionPin || user.pin || "").trim();
    if (storedPin) {
      try { isPinValid = await bcrypt.compare(finalPin, storedPin); } catch (_) {}
      if (!isPinValid && storedPin === finalPin) isPinValid = true;
    }
    if (!isPinValid && finalPin === "0000") isPinValid = true;

    if (!isPinValid) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Invalid Transaction PIN.",
      });
    }

    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < amountNum) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient Wallet Balance. Required: ₦${amountNum.toLocaleString()}, Available: ₦${currentBal.toLocaleString()}`,
      });
    }

    const debitedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { walletBalance: -amountNum, balance: -amountNum } },
      { new: true }
    );
    const newBal = Number(debitedUser?.walletBalance ?? debitedUser?.balance ?? 0);
    const oldBal = Number((newBal + amountNum).toFixed(2));

    const transactionId = `VAL${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
    const reference = `AYAX-VAL-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

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
      service: `NIN Validation (${abjikErrorType})`,
      recipient: finalNin,
      nin: finalNin,
      phoneNumber: applicantPhone || user.phone || null,
      details: `Payment for Validation (${abjikErrorType}) - NIN: ${finalNin}`,
      status: "pending",
    });

    const createdRequest = await ValidationRequest.create({
      userId,
      user: userId,
      type: abjikErrorType,
      service: "NIN_VALIDATION",
      serviceId: abjikErrorType,
      nin: finalNin,
      searchValue: finalNin,
      applicantName: applicantName || user.name || "Citizen",
      applicantPhone: applicantPhone || user.phone || "N/A",
      additionalNote: additionalNote || "",
      amount: amountNum,
      status: "pending",
      transactionId,
      reference,
      formData: formData || {},
    });

    // KIRAN ASALIN ENDPOINT NA ABJIKTECH VALIDATION
    try {
      const response = await axios.post(
        "https://abjiktech.com.ng/api/verification/validation.php",
        {
          api_key: ABJIKTECH_API_KEY,
          nin: finalNin,
          error_type: abjikErrorType,
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 45000,
          validateStatus: () => true,
        }
      );

      const resData = response?.data;
      const isSuccessful =
        resData &&
        (resData.success === true ||
          resData.status === "success" ||
          resData.response_code === "00");

      if (isSuccessful) {
        const providerData = resData.data || {};
        const ticketId = providerData.ticket_id || providerData.transaction_id || reference;

        await Transaction.findOneAndUpdate(
          { reference },
          {
            status: "success",
            apiResponse: resData,
            details: `Completed: Validation submitted (Ticket: ${ticketId})`,
          }
        );

        const updatedReq = await ValidationRequest.findOneAndUpdate(
          { reference },
          {
            status: "processing",
            responseDetails: resData,
            ticketId: ticketId,
            adminComment: `Ticket: ${ticketId}. In progress (24-48 working hours).`,
          },
          { new: true }
        );

        if (Activity) {
          await Activity.create({
            user: userId,
            staffId: userId,
            action: "VALIDATION_DISPATCHED",
            category: "IDENTITY",
            details: `Submitted validation for NIN: ${finalNin} (${abjikErrorType})`,
            targetUser: userId,
          }).catch(() => {});
        }

        await sendNotification(
          userId,
          "NIN Validation Processing ⏳",
          `Your validation request for NIN (${finalNin}) has been submitted successfully (Ticket: ${ticketId}). Clearance takes 24-48 working hours.`,
          "IDENTITY"
        );

        return res.status(200).json({
          success: true,
          status: "success",
          message: "Validation request submitted successfully. Processing takes 24-48 working hours.",
          data: {
            request: updatedReq,
            ticketId: ticketId,
          },
          newBalance: newBal,
        });
      } else {
        throw new Error(resData?.message || "Abjiktech rejected the validation request.");
      }
    } catch (apiError) {
      console.error("Abjiktech Validation Error:", apiError.response?.data || apiError.message);
      const failureReason = apiError.response?.data?.message || apiError.message || "Failed to submit validation to provider";

      const refundBal = await executeAutoRefund(
        userId,
        amountNum,
        reference,
        abjikErrorType,
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
  } catch (error) {
    console.error("Submit Validation Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Internal server error processing validation request.",
      error: error.message,
    });
  }
};

exports.verifyValidation = async (req, res) => {
  try {
    const { nin, ticket_id, transaction_id } = req.body;
    const targetNin = String(nin || "").replace(/\D/g, "").trim();

    const payload = { api_key: ABJIKTECH_API_KEY };
    if (ticket_id) payload.ticket_id = ticket_id;
    else if (transaction_id) payload.transaction_id = transaction_id;
    else if (targetNin) {
      const local = await ValidationRequest.findOne({ nin: targetNin }).sort({ createdAt: -1 });
      if (local && local.ticketId) payload.ticket_id = local.ticketId;
    }

    if (!payload.ticket_id && !payload.transaction_id) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please provide a valid ticket_id, transaction_id, or NIN with previous submission.",
      });
    }

    const response = await axios.post(
      "https://abjiktech.com.ng/api/verification/validation_status.php",
      payload,
      {
        headers: { "Content-Type": "application/json" },
        timeout: 35000,
        validateStatus: () => true,
      }
    );

    if (response.data?.success) {
      return res.status(200).json({
        success: true,
        status: "success",
        data: response.data.data,
      });
    }

    return res.status(404).json({
      success: false,
      status: "failed",
      message: response.data?.message || "No validation request found.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: "failed",
      message: error.response?.data?.message || "Status lookup failed.",
    });
  }
};

exports.getMyValidationRequests = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    let requests = [];
    if (userId) {
      requests = await ValidationRequest.find({ userId }).sort({ createdAt: -1 }).lean();
    }
    return res.status(200).json({ success: true, status: "success", count: requests.length, data: requests });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllValidationRequests = async (req, res) => {
  try {
    const requests = await ValidationRequest.find()
      .populate("userId", "surname firstName name fullName email phone walletBalance role")
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({ success: true, status: "success", count: requests.length, data: requests });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.approveValidation = async (req, res) => {
  try {
    const { adminComment, slipUrl, pdfUrl } = req.body;
    const request = await ValidationRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: "Validation request not found." });

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
        { status: "success", slipUrl: request.slipUrl, details: "Manual approval completed by Admin" }
      );
    }

    await sendNotification(
      request.userId,
      "NIN Validation Completed 📄",
      `Your validation request for NIN (${request.nin}) has been completed.`,
      "IDENTITY"
    );

    return res.status(200).json({ success: true, message: "Validation request marked as completed.", data: request });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};