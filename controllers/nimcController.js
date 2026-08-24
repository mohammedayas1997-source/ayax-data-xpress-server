const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const NIMCRequest = require("../models/NIMCRequest");
const NIMCPrice = require("../models/NIMCPrice");
const Activity = require("../models/Activity");
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
    console.error("NIMC Notification Error:", error.message);
  }
};

/**
 * 1. SUBMIT NIMC / NIN APPLICATION OR VERIFICATION REQUEST
 * Handles: Live charging, validation, PIN authentication, Ayax Gateway dispatch & Instant refund
 * @route POST /api/v1/nimc/submit-request (or /api/v1/nimc/request-modification)
 */
exports.submitNIMCRequest = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const {
      type,
      serviceType,
      serviceId,
      nin,
      ninNumber,
      searchValue,
      trackingId,
      phoneNumber,
      pin,
      transactionPin,
      details,
      formData,
      amount,
    } = req.body;

    const finalServiceType = String(serviceType || type || serviceId || "nin_verification").trim();
    const finalNin = String(ninNumber || nin || searchValue || "").trim();
    const finalPin = String(pin || transactionPin || "").trim();
    const finalDetails = formData || details || {};
    const userId = req.user._id || req.user.id;

    if (!finalServiceType || (!finalNin && !trackingId && !phoneNumber) || !finalPin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please provide service type, identification parameter (NIN/Phone/TrackingID), and your PIN.",
      });
    }

    const user = await User.findById(userId)
      .select("+transactionPin +pin +walletBalance balance")
      .session(session);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "User account not found." });
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
        message: "Invalid Transaction PIN.",
      });
    }

    // B. Calculate Cost via NIMCPrice Matrix or Fallback
    let amountToCharge = Number(amount || 0);
    const pricing = await NIMCPrice.findOne({
      $or: [
        { serviceType: finalServiceType },
        { serviceId: finalServiceType },
        { name: finalServiceType },
      ],
    });

    if (pricing && pricing.amount > 0) {
      amountToCharge = Number(pricing.amount);
    } else if (amountToCharge <= 0) {
      amountToCharge = 150; // Default fallback price
    }

    // C. Verify Wallet Balance
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < amountToCharge) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient Wallet Balance. Required: ₦${amountToCharge.toLocaleString()}, Available: ₦${currentBal.toLocaleString()}`,
      });
    }

    const transactionId = `NIMC${Date.now()}${Math.floor(Math.random() * 10000)}`;
    const reference = `AYAX-NIMC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // D. Deduct Wallet Balance Atomically
    const newBal = Number((currentBal - amountToCharge).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save({ session });

    // E. Save Transaction Entry
    const transaction = new Transaction({
      user: userId,
      transactionId,
      reference,
      type: "nin_verification",
      category: "DEBIT",
      amount: amountToCharge,
      oldBalance: currentBal,
      newBalance: newBal,
      nin: finalNin || null,
      phoneNumber: phoneNumber || null,
      details: `Payment for NIMC Service (${finalServiceType})`,
      status: "pending",
    });
    await transaction.save({ session });

    // F. Create Initial NIMC Request Record
    const nimcRequest = new NIMCRequest({
      user: userId,
      serviceType: finalServiceType,
      ninNumber: finalNin,
      trackingId: trackingId || null,
      phoneNumber: phoneNumber || null,
      searchValue: finalNin || trackingId || phoneNumber,
      formData: finalDetails,
      amount: amountToCharge,
      status: "pending",
      transactionId,
      reference,
    });
    await nimcRequest.save({ session });

    await session.commitTransaction();
    session.endSession();

    // G. Dispatch Live Processing to Ayax NIMC Gateway
    let ayaxResponse;
    const candidateEndpoints = [
      `${AYAX_API_BASE_URL}/identity/nimc/process`,
      `${AYAX_API_BASE_URL}/identity/nin/verify`,
      `${AYAX_API_BASE_URL}/nimc/verify`,
    ];

    try {
      for (const endpoint of candidateEndpoints) {
        try {
          ayaxResponse = await axios.post(
            endpoint,
            {
              serviceType: finalServiceType,
              nin: finalNin,
              searchValue: finalNin || trackingId || phoneNumber,
              trackingId,
              phone: phoneNumber,
              reference,
              ref_id: reference,
              details: finalDetails,
              amount: amountToCharge,
            },
            {
              headers: getHeaders(),
              timeout: 45000,
            }
          );
          if (ayaxResponse.data) break;
        } catch (e) {
          if (endpoint === candidateEndpoints[candidateEndpoints.length - 1]) throw e;
        }
      }

      const resData = ayaxResponse.data;
      const isSuccessful =
        resData &&
        (resData.success === true ||
          resData.status === "success" ||
          resData.status === true ||
          resData.code === 200 ||
          resData.code === "200");

      if (isSuccessful) {
        const resultPayload = resData.data || resData;
        const slipDocumentUrl =
          resultPayload.slipUrl ||
          resultPayload.pdfUrl ||
          resultPayload.url ||
          null;

        await Transaction.findOneAndUpdate(
          { reference },
          {
            status: "success",
            slipUrl: slipDocumentUrl,
            apiResponse: resultPayload,
            details: `Completed: ${finalServiceType} processed successfully`,
          }
        );

        const updatedRequest = await NIMCRequest.findOneAndUpdate(
          { reference },
          {
            status: "completed",
            resolvedAt: new Date(),
            slipUrl: slipDocumentUrl,
            pdfUrl: slipDocumentUrl,
            details: resultPayload,
          },
          { new: true }
        );

        await Activity.create({
          user: userId,
          staffId: userId,
          action: "NIMC_REQUEST_COMPLETED",
          category: "IDENTITY",
          details: `Processed NIMC ${finalServiceType} for ID ${finalNin || trackingId || phoneNumber}`,
          targetUser: userId,
        }).catch(() => {});

        await sendNotification(
          userId,
          "NIMC Request Completed 🎉",
          `Your ${finalServiceType} application for ID (${finalNin || "N/A"}) has been successfully processed. You can download your slip in Application History.`,
          "NIN_SERVICE"
        );

        return res.status(200).json({
          success: true,
          status: "success",
          message: "NIMC Request processed successfully via Ayax APIs.",
          data: updatedRequest,
          slipUrl: slipDocumentUrl,
          newBalance: newBal,
        });
      } else {
        throw new Error(resData?.message || "Ayax NIMC Gateway declined processing.");
      }
    } catch (apiError) {
      console.error(
        "Ayax NIMC API Gateway Error:",
        apiError.response?.status,
        apiError.response?.data || apiError.message
      );

      // Automated Instant Refund
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + amountToCharge).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      const reason =
        apiError.response?.data?.message || apiError.message || "Provider communication timed out";

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "failed",
          isRefunded: true,
          refundReason: reason,
          details: `Declined & Refunded: ${reason}`,
        }
      );

      await NIMCRequest.findOneAndUpdate(
        { reference },
        { status: "rejected", adminComment: reason }
      );

      await sendNotification(
        userId,
        "NIMC Service Refunded",
        `Your application for ${finalServiceType} was declined (${reason}). ₦${amountToCharge.toLocaleString()} has been refunded to your wallet balance.`,
        "REFUND"
      );

      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Processing failed: ${reason}. ₦${amountToCharge.toLocaleString()} has been refunded to your wallet.`,
      });
    }
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("NIMC Processing Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Internal server error occurred while processing NIMC request.",
      error: error.message,
    });
  }
};

/**
 * 2. LIVE VERIFY NIMC DIRECTLY (SEARCH WITHOUT REQUIRING MANUAL SLIP)
 * @route POST /api/v1/nimc/verify
 */
exports.verifyNIMC = async (req, res) => {
  try {
    const { searchValue, searchType } = req.body;

    if (!searchValue) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please enter a valid search identifier (NIN, Phone Number, or Tracking ID).",
      });
    }

    const payload = {
      searchValue: String(searchValue).trim(),
      searchType: searchType || "nin",
    };

    if (searchType === "phone") {
      payload.phone = searchValue;
    } else if (searchType === "trackingId") {
      payload.trackingId = searchValue;
    } else if (searchType === "face") {
      payload.image = searchValue;
    } else {
      payload.nin = searchValue;
    }

    const response = await axios.post(
      `${AYAX_API_BASE_URL}/identity/nin/verify`,
      payload,
      {
        headers: getHeaders(),
        timeout: 30000,
      }
    );

    const resData = response.data;
    const isSuccessful =
      resData &&
      (resData.success === true ||
        resData.status === "success" ||
        resData.status === true ||
        resData.code === 200 ||
        resData.code === "200");

    if (isSuccessful) {
      return res.status(200).json({
        success: true,
        status: "success",
        message: "NIMC verification successful via Ayax APIs.",
        data: resData.data || resData,
      });
    }

    return res.status(400).json({
      success: false,
      status: "failed",
      message: resData?.message || "NIMC Record not found.",
    });
  } catch (error) {
    console.error("NIMC Quick Verification Error:", error.response?.status, error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      success: false,
      status: "failed",
      message: error.response?.data?.message || "Could not complete identity verification from Ayax APIs.",
      error: error.message,
    });
  }
};

/**
 * 3. GET USER NIMC APPLICATION HISTORY
 * @route GET /api/v1/nimc/my-requests
 */
exports.getMyNIMCRequests = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const requests = await NIMCRequest.find({ user: userId })
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
      message: "Failed to fetch NIMC history.",
      error: error.message,
    });
  }
};

/**
 * 4. ADMIN: GET ALL APPLICANT REQUESTS
 * @route GET /api/v1/nimc/admin/all
 */
exports.getAllNIMCRequests = async (req, res) => {
  try {
    const requests = await NIMCRequest.find()
      .populate("user", "surname firstName fullName phone email walletBalance")
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
      message: error.message,
    });
  }
};

/**
 * 5. ADMIN: UPDATE APPLICATION STATUS TO PROCESSING
 * @route PATCH /api/v1/nimc/processing/:id
 */
exports.updateToProcessing = async (req, res) => {
  try {
    const request = await NIMCRequest.findByIdAndUpdate(
      req.params.id,
      { status: "processing" },
      { new: true }
    );

    if (!request) {
      return res.status(404).json({ success: false, message: "Request record not found." });
    }

    return res.status(200).json({
      success: true,
      status: "success",
      message: "Request marked as processing.",
      data: request,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 6. ADMIN: APPROVE AND UPLOAD RESULT SLIP
 * @route PATCH /api/v1/nimc/approve/:id
 */
exports.approveRequest = async (req, res) => {
  try {
    const { adminNote, slipUrl, pdfUrl } = req.body;
    const request = await NIMCRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ success: false, message: "Request record not found." });
    }

    request.status = "completed";
    request.resolvedAt = new Date();
    if (adminNote) request.adminComment = adminNote;
    if (slipUrl || pdfUrl) {
      request.slipUrl = slipUrl || pdfUrl;
      request.pdfUrl = pdfUrl || slipUrl;
    }
    request.processedBy = req.user._id || req.user.id;

    await request.save();

    // Update corresponding transaction ledger
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
      request.user,
      "NIMC Result Slip Ready 📄",
      `Your verification slip for NIN (${request.ninNumber || "Application"}) is ready for download in your Application History.`,
      "NIN_SERVICE"
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: "Request completed and result slip attached successfully.",
      data: request,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};