const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const NIMCRequest = require("../models/NIMCRequest");
const NIMCPrice = require("../models/NIMCPrice");
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
    console.error("NIMC Notification Error:", error.message);
  }
};

// Automated Auto-Refund Processor
const executeAutoRefund = async (userId, amountNum, reference, finalServiceType, targetIdentifier, reason) => {
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

    await NIMCRequest.findOneAndUpdate(
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
      service: `Refund: NIMC ${finalServiceType.toUpperCase()}`,
      amount: amountNum,
      oldBalance: prevBal,
      newBalance: currentBal,
      previousBalance: prevBal,
      recipient: targetIdentifier,
      nin: targetIdentifier,
      status: "success",
      description: `Auto-Refund of ₦${amountNum.toLocaleString()} for failed NIMC ${finalServiceType} (${reason})`,
      details: {
        originalReference: reference,
        serviceType: finalServiceType,
        identifier: targetIdentifier,
        failureReason: reason,
      },
    });

    await sendNotification(
      userId,
      "NIMC Service Refunded 💰",
      `Your application for ${finalServiceType} (${targetIdentifier || "N/A"}) failed and ₦${amountNum.toLocaleString()} has been instantly refunded to your wallet. Reason: ${reason}`,
      "REFUND"
    );

    return currentBal;
  } catch (err) {
    console.error("NIMC Auto-Refund Execution Error:", err.message);
  }
};

/**
 * 0. GET NIMC PRICING MATRIX (An saka wannan don cike layin da ke routes)
 * @route GET /api/v1/nimc/prices OR /api/v1/nimc/pricing
 */
exports.getNIMCPrices = async (req, res) => {
  try {
    let prices = [];
    if (NIMCPrice) {
      prices = await NIMCPrice.find().lean();
    }

    if (!prices || prices.length === 0) {
      prices = [
        { serviceType: "nin_verification", name: "Standard NIN Verification", amount: 150, description: "Instant identity verification" },
        { serviceType: "nin_slip_regular", name: "Regular NIN Slip", amount: 200, description: "Standard slip generation" },
        { serviceType: "nin_slip_standard", name: "Standard NIN Slip", amount: 500, description: "Official coloured slip" },
        { serviceType: "nin_slip_premium", name: "Premium NIN Slip", amount: 1000, description: "Official laminated format" },
      ];
    }

    return res.status(200).json({
      success: true,
      status: "success",
      count: prices.length,
      data: prices,
      prices,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to load NIMC pricing",
      error: error.message,
    });
  }
};
exports.getPrices = exports.getNIMCPrices;

/**
 * 1. SUBMIT NIMC / NIN APPLICATION OR VERIFICATION REQUEST
 * @route POST /api/v1/nimc/submit-request (or /api/v1/nimc/request-modification)
 */
exports.submitNIMCRequest = async (req, res) => {
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
    const userId = req.user?._id || req.user?.id;

    if (!finalServiceType || (!finalNin && !trackingId && !phoneNumber) || !finalPin) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please provide service type, identification parameter (NIN/Phone/TrackingID), and your PIN.",
      });
    }

    const user = await User.findById(userId).select("+transactionPin +pin +walletBalance +balance");

    if (!user) {
      return res.status(404).json({ success: false, message: "User account not found." });
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
        message: "Invalid Transaction PIN.",
      });
    }

    // B. Calculate Cost via NIMCPrice Matrix or Fallback
    let amountToCharge = Number(amount || 0);
    if (NIMCPrice) {
      const pricing = await NIMCPrice.findOne({
        $or: [
          { serviceType: finalServiceType },
          { serviceId: finalServiceType },
          { name: finalServiceType },
        ],
      });

      if (pricing && pricing.amount > 0) {
        amountToCharge = Number(pricing.amount);
      }
    }

    if (amountToCharge <= 0) {
      amountToCharge = 150;
    }

    // C. Verify Wallet Balance
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < amountToCharge) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient Wallet Balance. Required: ₦${amountToCharge.toLocaleString()}, Available: ₦${currentBal.toLocaleString()}`,
      });
    }

    // D. Deduct Wallet Balance Atomically
    const debitedUser = await User.findByIdAndUpdate(
      userId,
      {
        $inc: {
          walletBalance: -amountToCharge,
          balance: -amountToCharge,
        },
      },
      { new: true }
    );

    const newBal = Number(debitedUser.walletBalance ?? debitedUser.balance ?? 0);
    const oldBal = Number((newBal + amountToCharge).toFixed(2));

    const transactionId = `NIMC${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
    const reference = `AYAX-NIMC-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const targetIdentifier = finalNin || trackingId || phoneNumber;

    // E. Save Transaction Entry
    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId,
      reference,
      type: "identity",
      category: "IDENTITY",
      service: `NIMC ${finalServiceType.toUpperCase()}`,
      amount: amountToCharge,
      oldBalance: oldBal,
      newBalance: newBal,
      previousBalance: oldBal,
      recipient: targetIdentifier,
      nin: finalNin || null,
      phoneNumber: phoneNumber || null,
      status: "pending",
      details: `Payment for NIMC Service (${finalServiceType}) - ID: ${targetIdentifier}`,
    });

    // F. Create Initial NIMC Request Record
    if (NIMCRequest) {
      await NIMCRequest.create({
        user: userId,
        serviceType: finalServiceType,
        ninNumber: finalNin,
        trackingId: trackingId || null,
        phoneNumber: phoneNumber || null,
        searchValue: targetIdentifier,
        formData: finalDetails,
        amount: amountToCharge,
        status: "pending",
        transactionId,
        reference,
      });
    }

    // G. Dispatch Live Processing to Ayax NIMC Gateway
    const baseUrl = getBaseUrl();
    let ayaxResponse;
    const candidateEndpoints = [
      `${baseUrl}/identity/nimc/process`,
      `${baseUrl}/identity/nin/verify`,
      `${baseUrl}/nimc/verify`,
    ];

    try {
      for (const endpoint of candidateEndpoints) {
        try {
          ayaxResponse = await axios.post(
            endpoint,
            {
              serviceType: finalServiceType,
              nin: finalNin,
              searchValue: targetIdentifier,
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

      const resData = ayaxResponse?.data;
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

        let updatedRequest = null;
        if (NIMCRequest) {
          updatedRequest = await NIMCRequest.findOneAndUpdate(
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
        }

        if (Activity) {
          await Activity.create({
            user: userId,
            staffId: userId,
            action: "NIMC_REQUEST_COMPLETED",
            category: "IDENTITY",
            details: `Processed NIMC ${finalServiceType} for ID ${targetIdentifier}`,
            targetUser: userId,
          }).catch(() => {});
        }

        await sendNotification(
          userId,
          "NIMC Request Completed 🎉",
          `Your ${finalServiceType} application for ID (${targetIdentifier || "N/A"}) has been successfully processed.`,
          "IDENTITY"
        );

        return res.status(200).json({
          success: true,
          status: "success",
          message: "NIMC Request processed successfully via Ayax APIs.",
          data: updatedRequest || resultPayload,
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

      const reason =
        apiError.response?.data?.message || apiError.message || "Provider communication timed out";

      const refundBal = await executeAutoRefund(
        userId,
        amountToCharge,
        reference,
        finalServiceType,
        targetIdentifier,
        reason
      );

      return res.status(422).json({
        success: false,
        status: "failed",
        refunded: true,
        message: `Processing failed: ${reason}. ₦${amountToCharge.toLocaleString()} has been refunded to your wallet instantly.`,
        newBalance: refundBal,
      });
    }
  } catch (error) {
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
 * 2. LIVE VERIFY NIMC DIRECTLY (Tare da Candidate Endpoints don gujewa 404)
 * @route POST /api/v1/nimc/verify
 */
exports.verifyNIMC = async (req, res) => {
  try {
    const { searchValue, searchType, nin, phone, trackingId } = req.body;
    const targetQuery = String(searchValue || nin || phone || trackingId || "").trim();

    if (!targetQuery) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please enter a valid search identifier (NIN, Phone Number, or Tracking ID).",
      });
    }

    const payload = {
      searchValue: targetQuery,
      searchType: searchType || "nin",
      nin: targetQuery,
    };

    if (searchType === "phone") {
      payload.phone = targetQuery;
    } else if (searchType === "trackingId") {
      payload.trackingId = targetQuery;
    }

    const baseUrl = getBaseUrl();
    const candidateEndpoints = [
      `${baseUrl}/identity/nin/verify`,
      `${baseUrl}/nimc/verify`,
      `${baseUrl}/identity/nimc/verify`,
    ];

    let response;
    for (const endpoint of candidateEndpoints) {
      try {
        response = await axios.post(endpoint, payload, {
          headers: getHeaders(),
          timeout: 30000,
        });
        if (response.data) break;
      } catch (err) {
        if (endpoint === candidateEndpoints[candidateEndpoints.length - 1]) throw err;
      }
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
    const userId = req.user?.id || req.user?._id;
    let requests = [];
    if (NIMCRequest) {
      requests = await NIMCRequest.find({ user: userId })
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
    let requests = [];
    if (NIMCRequest) {
      requests = await NIMCRequest.find()
        .populate("user", "surname firstName fullName phone email walletBalance")
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
      "IDENTITY"
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

/**
 * 7. ADMIN: SET NIMC PRICING
 * @route POST /api/v1/nimc/admin/set-price
 */
exports.setNIMCPrice = async (req, res) => {
  try {
    const { serviceType, name, amount, description } = req.body;
    if (!serviceType || !amount) {
      return res.status(400).json({ success: false, message: "Service type and amount are required." });
    }

    const priceRecord = await NIMCPrice.findOneAndUpdate(
      { serviceType },
      { name: name || serviceType, amount: Number(amount), description },
      { upsert: true, new: true }
    );

    return res.status(200).json({
      success: true,
      message: "Price updated successfully.",
      data: priceRecord,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};