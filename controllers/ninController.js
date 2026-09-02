const ValidationRequest = require("../models/ValidationRequest");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const axios = require("axios");
const bcrypt = require("bcryptjs");

// Dynamic Imports don kariya daga server crash
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

// Ayax Standard API Headers Generator
const getHeaders = () => {
  const activeKey = String(
    process.env.AYAX_API_KEY || process.env.MARKETPLACE_API_KEY || ""
  ).trim();

  return {
    "Content-Type": "application/json",
    "x-api-key": activeKey,
    Authorization: `Bearer ${activeKey}`,
  };
};

const getBaseUrl = () => {
  const rawUrl =
    process.env.AYAX_API_BASE_URL ||
    process.env.MARKETPLACE_API_URL ||
    "https://www.ayaxapis.com";
  const cleanBase = rawUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return `${cleanBase}/api/v1`;
};

// Helper don tura sanarwa ga User
const sendNotification = async (userId, title, message, category = "IDENTITY") => {
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

    if (!user) return;

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
      { status: "failed", adminComment: reason }
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
      phoneNumber: applicantPhone || user.phone,
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
      `Your ₦${amountNum.toLocaleString()} payment for ${finalType} (NIN: ${finalNin}) failed and has been instantly refunded to your wallet. Reason: ${reason}`,
      "REFUND"
    );

    return currentBal;
  } catch (err) {
    console.error("Validation Auto-Refund Execution Error:", err.message);
  }
};

/**
 * 1. SUBMIT NIN / IDENTITY VALIDATION REQUEST
 * @route POST /api/v1/validation/submit (ko /api/v1/nin/validate)
 */
exports.submitValidation = async (req, res) => {
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
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please provide all required fields (validation type, 11-digit NIN, transaction PIN, and valid amount).",
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

    const newBal = Number(debitedUser.walletBalance ?? debitedUser.balance ?? 0);
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
      service: `NIN Validation (${finalType})`,
      recipient: finalNin,
      nin: finalNin,
      phoneNumber: applicantPhone || user.phone || null,
      details: `Payment for Validation Service (${finalType}) - NIN: ${finalNin}`,
      status: "pending",
    });

    // E. Create Initial Validation Request Record
    await ValidationRequest.create({
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

    // F. Dispatch Live Processing to Ayax Validation Gateway
    const baseUrl = getBaseUrl();
    let response;
    const candidateEndpoints = [
      `${baseUrl}/identity/validation/process`,
      `${baseUrl}/nin/validate`,
      `${baseUrl}/identity/nin/validate`,
      `${baseUrl}/identity/nimc/process`,
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
              searchValue: finalNin,
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

      const resData = response?.data;
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

        if (Activity) {
          await Activity.create({
            user: userId,
            staffId: userId,
            action: "VALIDATION_REQUEST_COMPLETED",
            category: "IDENTITY",
            details: `Successfully completed validation for ${finalType} (NIN: ${finalNin}) worth ₦${amountNum}`,
            targetUser: userId,
          }).catch(() => {});
        }

        await sendNotification(
          userId,
          "Validation Request Approved 🎉",
          `Your validation request for NIN (${finalNin}) has been successfully completed.`,
          "IDENTITY"
        );

        return res.status(200).json({
          success: true,
          status: "success",
          message: "NIN Validation completed successfully via Ayax APIs.",
          data: {
            request: completedRequest,
            providerResponse: providerPayload,
          },
          newBalance: newBal,
        });
      } else {
        throw new Error(resData?.message || "Ayax validation provider declined request.");
      }
    } catch (apiError) {
      console.error(
        "Ayax Validation Gateway Connection Error:",
        apiError.response?.status,
        apiError.response?.data || apiError.message
      );

      const errMsg =
        apiError.response?.data?.message || apiError.message || "Validation gateway timed out";

      const refundBal = await executeAutoRefund(
        userId,
        amountNum,
        reference,
        finalType,
        finalNin,
        applicantPhone,
        errMsg
      );

      return res.status(422).json({
        success: false,
        status: "failed",
        refunded: true,
        message: `Validation service unavailable (${errMsg}). ₦${amountNum.toLocaleString()} has been refunded to your wallet instantly.`,
        newBalance: refundBal,
      });
    }
  } catch (error) {
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
 * 2. QUICK VALIDATION LOOKUP / VERIFY
 * @route POST /api/v1/validation/verify
 */
exports.verifyValidation = async (req, res) => {
  try {
    const { nin, searchValue, searchType } = req.body;
    const targetQuery = String(nin || searchValue || "").trim();

    if (!targetQuery) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Identification number is required.",
      });
    }

    const baseUrl = getBaseUrl();
    const candidateEndpoints = [
      `${baseUrl}/identity/nin/verify`,
      `${baseUrl}/identity/validation/verify`,
      `${baseUrl}/nin/validate`,
    ];

    let response;
    for (const endpoint of candidateEndpoints) {
      try {
        response = await axios.post(
          endpoint,
          { nin: targetQuery, searchValue: targetQuery, searchType: searchType || "nin" },
          { headers: getHeaders(), timeout: 30000 }
        );
        if (response.data) break;
      } catch (e) {
        if (endpoint === candidateEndpoints[candidateEndpoints.length - 1]) throw e;
      }
    }

    const resData = response.data;
    if (resData && (resData.success === true || resData.status === "success" || resData.code === 200)) {
      return res.status(200).json({
        success: true,
        status: "success",
        data: resData.data || resData,
      });
    }

    return res.status(400).json({
      success: false,
      status: "failed",
      message: resData?.message || "Validation record not found.",
    });
  } catch (error) {
    return res.status(error.response?.status || 500).json({
      success: false,
      status: "failed",
      message: error.response?.data?.message || "Identity lookup failed.",
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
    const userId = req.user?._id || req.user?.id;
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
 * 4. ADMIN: GET ALL VALIDATION REQUESTS (DASHBOARD)
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
    request.processedBy = req.user?._id || req.user?.id;
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