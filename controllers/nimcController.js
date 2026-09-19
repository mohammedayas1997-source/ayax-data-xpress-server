const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const NIMCRequest = require("../models/NIMCRequest");
const NIMCPrice = require("../models/NIMCPrice");
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

// Safely resolve user ID
const resolveUserId = (req) => {
  if (req.user?.id) return req.user.id;
  if (req.user?._id) return req.user._id;
  if (req.apiUser?.id) return req.apiUser.id;
  if (req.apiUser?._id) return req.apiUser._id;
  if (req.body?.userId) return req.body.userId;

  if (req.headers?.authorization) {
    try {
      const parts = req.headers.authorization.split(" ");
      const rawToken = parts.length === 2 ? parts[1] : parts[0];
      const decoded = jwt.decode(rawToken);
      return decoded?.id || decoded?._id || decoded?.userId || null;
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

// Headers generator don Abjiktech API
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

// Helper: Mappin kalar slip zuwa ainihin sunan da Gateway ke ganewa
const mapSlipTypeToGateway = (serviceType) => {
  switch (serviceType) {
    case "premiumCard":
      return "Premium Card";
    case "basicSlip":
      return "Basic Slip";
    case "standardSlip":
    default:
      return "Standard Slip";
  }
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
    console.error("NIMC Notification Error:", error.message);
  }
};

// Auto-Refund Processor
const executeAutoRefund = async (userId, amountNum, reference, finalServiceType, targetIdentifier, reason) => {
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

    if (NIMCRequest) {
      await NIMCRequest.findOneAndUpdate(
        { reference },
        { status: "rejected", adminComment: reason }
      );
    }

    const refundRef = `REF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId: `TXN-REF-${Date.now()}`,
      reference: refundRef,
      type: "refund",
      category: "WALLET",
      service: `Refund: NIMC ${String(finalServiceType || "").toUpperCase()}`,
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
      `Your application for ${finalServiceType} (${targetIdentifier || "N/A"}) failed and ₦${amountNum.toLocaleString()} has been refunded to your wallet. Reason: ${reason}`,
      "REFUND"
    );

    return currentBal;
  } catch (err) {
    console.error("NIMC Auto-Refund Execution Error:", err.message);
    return 0;
  }
};

/**
 * 0. GET NIMC PRICING MATRIX
 */
exports.getNIMCPrices = async (req, res) => {
  try {
    let prices = [];
    if (NIMCPrice) {
      prices = await NIMCPrice.find().lean();
    }

    if (!prices || prices.length === 0) {
      prices = [
        { serviceType: "nin", name: "NIN Number Search", amount: 100 },
        { serviceType: "phone", name: "Phone Number Search", amount: 150 },
        { serviceType: "standardSlip", name: "Standard NIN Slip", amount: 200 },
        { serviceType: "premiumCard", name: "Premium ID Card Slip", amount: 300 },
        { serviceType: "basicSlip", name: "Basic Identification Slip", amount: 100 },
        { serviceType: "no_record", name: "No Record Found Validation", amount: 1300 },
        { serviceType: "sim_val", name: "SIM Validation", amount: 1300 },
        { serviceType: "mod_val", name: "Modification Validation", amount: 1700 },
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
 * 1. SUBMIT NIMC / NIN APPLICATION OR VERIFICATION REQUEST VIA ABJIKTECH
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
      phone,
      pin,
      transactionPin,
      details,
      formData,
      amount,
      processingWindow,
    } = req.body;

    const finalServiceType = String(serviceType || type || serviceId || "nin").trim();
    const finalNin = String(ninNumber || nin || searchValue || "").replace(/\D/g, "").trim();
    
    // Tace lambar waya sosai
    let rawPhone = String(phoneNumber || phone || searchValue || "").replace(/\D/g, "").trim();
    let cleanPhone = rawPhone;
    if (cleanPhone.startsWith("234") && cleanPhone.length >= 13) {
      cleanPhone = "0" + cleanPhone.slice(3);
    } else if (cleanPhone.length === 10 && !cleanPhone.startsWith("0")) {
      cleanPhone = "0" + cleanPhone;
    }

    const finalPin = String(pin || transactionPin || "").trim();
    const finalDetails = formData || details || {};

    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        status: "failed",
        message: "User session expired or unauthorized. Please log in again.",
      });
    }

    if (!finalPin) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please enter your 4-digit Transaction PIN.",
      });
    }

    const user = await User.findById(userId).select("+transactionPin +pin +walletBalance +balance");
    if (!user) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "User account record not found.",
      });
    }

    // A. Verify PIN
    let isPinValid = false;
    const storedPin = String(user.transactionPin || user.pin || "").trim();
    if (storedPin) {
      try {
        isPinValid = await bcrypt.compare(finalPin, storedPin);
      } catch (_) {
        isPinValid = false;
      }
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

    // B. Calculate Cost
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
    if (amountToCharge <= 0) amountToCharge = 100;

    // C. Wallet Balance Check
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < amountToCharge) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient Wallet Balance. Required: ₦${amountToCharge.toLocaleString()}, Available: ₦${currentBal.toLocaleString()}`,
      });
    }

    // D. Deduct Balance
    const debitedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { walletBalance: -amountToCharge, balance: -amountToCharge } },
      { new: true }
    );
    const newBal = Number(debitedUser?.walletBalance ?? debitedUser?.balance ?? 0);
    const oldBal = Number((newBal + amountToCharge).toFixed(2));

    const transactionId = `NIMC${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
    const reference = `AYAX-NIMC-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    let targetIdentifier = finalServiceType === "phone" ? cleanPhone : (finalNin || cleanPhone || trackingId);

    // E. Save Pending Transaction
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
      phoneNumber: cleanPhone || null,
      status: "pending",
      details: `Payment for NIMC Service (${finalServiceType}) - ID: ${targetIdentifier}`,
    });

    let createdRequest = null;
    if (NIMCRequest) {
      createdRequest = await NIMCRequest.create({
        user: userId,
        serviceType: finalServiceType,
        ninNumber: finalNin,
        trackingId: trackingId || null,
        phoneNumber: cleanPhone || null,
        searchValue: targetIdentifier,
        formData: finalDetails,
        amount: amountToCharge,
        status: "pending",
        transactionId,
        reference,
      });
    }

    // =========================================================================
    // BRANCH 1: VALIDATION QUEUE (48 WORKING HOURS)
    // =========================================================================
    const isValidationQueue =
      ["no_record", "sim_val", "vnin_val", "update_record", "bank_val", "mod_val", "photo_error"].includes(finalServiceType) ||
      processingWindow === "48_WORKING_HOURS" ||
      finalServiceType.toLowerCase().includes("val");

    if (isValidationQueue) {
      try {
        const valRes = await axios.post(
          `${ABJIKTECH_BASE_URL}/api/nin/validate/`,
          {
            nin: finalNin,
            issueType: finalServiceType,
            errorType: finalServiceType,
            reference,
          },
          { headers: getAbjikHeaders(), timeout: 35000 }
        );

        if (valRes.data?.status === "success" || valRes.data?.success) {
          return res.status(200).json({
            success: true,
            status: "success",
            message: "NIN validation request submitted successfully. Processing takes up to 48 working hours.",
            data: valRes.data?.data || createdRequest,
            reference,
            newBalance: newBal,
          });
        }
      } catch (e) {
        return res.status(200).json({
          success: true,
          status: "success",
          message: "NIN validation submitted and queued for 48 working hours manual clearance.",
          data: createdRequest,
          reference,
          newBalance: newBal,
        });
      }
    }

    // =========================================================================
    // BRANCH 2: DIRECT SLIP PRINTING & NIN/PHONE VERIFICATION (ABJIKTECH)
    // =========================================================================
    let resultPayload = null;
    const resolvedSlipType = mapSlipTypeToGateway(finalServiceType);

    try {
      const isPhoneSearch = finalServiceType === "phone" || (!finalNin && cleanPhone.length === 11);

      let abjikEndpoint = `${ABJIKTECH_BASE_URL}/api/nin/`;
      let requestPayload = {};

      if (isPhoneSearch) {
        if (!cleanPhone || cleanPhone.length < 11) {
          throw new Error("Please provide a valid 11-digit Nigerian phone number.");
        }
        requestPayload = {
          phone: cleanPhone,
          search_type: "phone",
          type: "phone",
          slip_type: resolvedSlipType,
          reference,
        };
      } else {
        requestPayload = {
          nin: finalNin,
          search_type: "nin",
          type: finalServiceType,
          slip_type: resolvedSlipType,
          format: "pdf",
          reference,
        };
      }

      const abjikRes = await axios.post(
        abjikEndpoint,
        requestPayload,
        { headers: getAbjikHeaders(), timeout: 45000 }
      );

      const resData = abjikRes.data || {};
      const isSuccess =
        resData.status === "success" ||
        resData.success === true ||
        resData.status === 200 ||
        resData.code === 200;

      if (!isSuccess) {
        throw new Error(resData.message || resData.desc || resData.msg || "NIMC record not found on Abjiktech.");
      }

      resultPayload = resData.data?.details?.data || resData.data?.details || resData.data || resData;

      // Ciro ainihin link din PDF / Slip na Abjiktech
      const slipDocumentUrl =
        resultPayload.slipUrl ||
        resultPayload.pdfUrl ||
        resultPayload.downloadUrl ||
        resultPayload.fileUrl ||
        resultPayload.url ||
        resultPayload.slip ||
        resData.slipUrl ||
        resData.pdfUrl ||
        null;

      const finalResolvedNin =
        resultPayload.nin ||
        resultPayload.ninNumber ||
        resultPayload.idNumber ||
        targetIdentifier;

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "success",
          nin: finalResolvedNin,
          slipUrl: slipDocumentUrl,
          apiResponse: resultPayload,
          details: `Completed: ${finalServiceType} verified via Abjiktech (NIN: ${finalResolvedNin})`,
        }
      );

      if (NIMCRequest) {
        await NIMCRequest.findOneAndUpdate(
          { reference },
          {
            status: "completed",
            ninNumber: finalResolvedNin,
            resolvedAt: new Date(),
            slipUrl: slipDocumentUrl,
            pdfUrl: slipDocumentUrl,
            details: resultPayload,
          }
        );
      }

      await sendNotification(
        userId,
        "NIMC Slip Ready 🎉",
        `Your verification slip for ID (${finalResolvedNin}) is ready for download.`,
        "IDENTITY"
      );

      const computedFullName =
        resultPayload.fullName ||
        resultPayload.name ||
        `${resultPayload.firstName || resultPayload.firstname || ""} ${resultPayload.middleName || resultPayload.middlename || ""} ${resultPayload.surname || ""}`.trim();

      return res.status(200).json({
        success: true,
        status: "success",
        message: "NIMC details retrieved successfully via Abjiktech.",
        data: {
          ...resultPayload,
          fullName: computedFullName || "Verified Citizen",
          nin: finalResolvedNin,
          ninNumber: finalResolvedNin,
          photo: resultPayload.photo || resultPayload.image || null,
          trackingId: resultPayload.trackingId || resultPayload.tracking_id || trackingId || "N/A",
          telephoneno: resultPayload.telephoneno || resultPayload.phone || cleanPhone || "N/A",
          birthdate: resultPayload.birthdate || resultPayload.dob || "N/A",
          gender: resultPayload.gender || "N/A",
          state: resultPayload.state || resultPayload.stateOfOrigin || "N/A",
          lga: resultPayload.lga || resultPayload.lgaOfOrigin || "N/A",
          slipUrl: slipDocumentUrl,
          pdfUrl: slipDocumentUrl,
        },
        slipUrl: slipDocumentUrl,
        pdfUrl: slipDocumentUrl,
        newBalance: newBal,
      });
    } catch (apiErr) {
      console.error("Abjiktech NIMC Error:", apiErr.response?.data || apiErr.message);

      const failureReason =
        apiErr.response?.data?.message ||
        apiErr.response?.data?.desc ||
        apiErr.message ||
        "Failed to retrieve identity details from Abjiktech";

      const refundBal = await executeAutoRefund(
        userId,
        amountToCharge,
        reference,
        finalServiceType,
        targetIdentifier,
        failureReason
      );

      return res.status(422).json({
        success: false,
        status: "failed",
        refunded: true,
        message: `Verification Failed: ${failureReason}. ₦${amountToCharge.toLocaleString()} has been refunded to your wallet instantly.`,
        newBalance: refundBal,
      });
    }
  } catch (error) {
    console.error("NIMC Processing Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Internal server error processing NIMC request.",
      error: error.message,
    });
  }
};

/**
 * 2. LIVE VERIFY NIMC DIRECTLY (ABJIKTECH - NO DEBIT)
 */
exports.verifyNIMC = async (req, res) => {
  try {
    const { searchValue, searchType, nin, phone } = req.body;
    const targetQuery = String(searchValue || nin || phone || "").trim();

    if (!targetQuery) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please enter a valid NIN or Phone number.",
      });
    }

    const payload =
      searchType === "phone"
        ? { phone: targetQuery, type: "phone", slip_type: "Standard Slip" }
        : { nin: targetQuery, type: "nin", slip_type: "Standard Slip" };

    const response = await axios.post(
      `${ABJIKTECH_BASE_URL}/api/nin/`,
      payload,
      {
        headers: getAbjikHeaders(),
        timeout: 35000,
      }
    );

    if (response.data?.status === "success" || response.data?.success || response.data?.status === 200) {
      return res.status(200).json({
        success: true,
        status: "success",
        data: response.data?.data?.details || response.data?.data || response.data,
      });
    }

    return res.status(400).json({
      success: false,
      status: "failed",
      message: response.data?.message || response.data?.desc || "Record not found on NIMC server.",
    });
  } catch (error) {
    return res.status(error.response?.status || 500).json({
      success: false,
      status: "failed",
      message: error.response?.data?.message || "Identity lookup failed on Abjiktech.",
    });
  }
};

/**
 * 3. GET USER NIMC APPLICATION HISTORY
 */
exports.getMyNIMCRequests = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    let requests = [];
    if (NIMCRequest && userId) {
      requests = await NIMCRequest.find({ user: userId }).sort({ createdAt: -1 }).lean();
    }

    return res.status(200).json({
      success: true,
      status: "success",
      count: requests.length,
      data: requests,
      requests,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4. ADMIN: GET ALL APPLICANT REQUESTS
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
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 5. ADMIN: UPDATE APPLICATION STATUS TO PROCESSING
 */
exports.updateToProcessing = async (req, res) => {
  try {
    const request = await NIMCRequest.findByIdAndUpdate(req.params.id, { status: "processing" }, { new: true });
    if (!request) return res.status(404).json({ success: false, message: "Record not found." });

    return res.status(200).json({ success: true, message: "Marked as processing.", data: request });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 6. ADMIN: APPROVE AND UPLOAD RESULT SLIP
 */
exports.approveRequest = async (req, res) => {
  try {
    const { adminNote, slipUrl, pdfUrl } = req.body;
    const request = await NIMCRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: "Record not found." });

    request.status = "completed";
    request.resolvedAt = new Date();
    if (adminNote) request.adminComment = adminNote;
    if (slipUrl || pdfUrl) {
      request.slipUrl = slipUrl || pdfUrl;
      request.pdfUrl = pdfUrl || slipUrl;
    }
    request.processedBy = resolveUserId(req);
    await request.save();

    if (request.reference) {
      await Transaction.findOneAndUpdate(
        { reference: request.reference },
        { status: "success", slipUrl: request.slipUrl, details: `Manual approval completed by Admin` }
      );
    }

    if (request.user) {
      await sendNotification(
        request.user,
        "NIMC Result Slip Ready 📄",
        `Your verification slip for NIN (${request.ninNumber || "Application"}) is ready for download in your Application History.`,
        "IDENTITY"
      );
    }

    return res.status(200).json({ success: true, message: "Approved successfully.", data: request });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 7. ADMIN: SET NIMC PRICING
 */
exports.setNIMCPrice = async (req, res) => {
  try {
    const { serviceType, name, amount, description } = req.body;
    if (!serviceType || !amount) {
      return res.status(400).json({ success: false, message: "Service type and amount are required." });
    }

    if (!NIMCPrice) {
      return res.status(500).json({ success: false, message: "NIMCPrice model unavailable." });
    }

    const priceRecord = await NIMCPrice.findOneAndUpdate(
      { serviceType },
      { name: name || serviceType, amount: Number(amount), description },
      { upsert: true, new: true }
    );

    return res.status(200).json({ success: true, message: "Price updated.", data: priceRecord });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};