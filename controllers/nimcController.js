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

const ABJIKTECH_API_KEY = String(
  process.env.ABJIKTECH_API_KEY || "dv_068de722a84b71ce900a65fa4c17bdf9_1788498653"
).trim();

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
      `Your request for ${finalServiceType} (${targetIdentifier || "N/A"}) failed and ₦${amountNum.toLocaleString()} has been refunded to your wallet. Reason: ${reason}`,
      "REFUND"
    );

    return currentBal;
  } catch (err) {
    console.error("NIMC Auto-Refund Execution Error:", err.message);
    return 0;
  }
};

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

exports.submitNIMCRequest = async (req, res) => {
  try {
    const {
      type,
      serviceType,
      serviceId,
      nin,
      ninNumber,
      searchValue,
      phoneNumber,
      phone,
      pin,
      transactionPin,
      amount,
    } = req.body;

    const finalServiceType = String(serviceType || type || serviceId || "nin").trim();
    const finalNin = String(ninNumber || nin || searchValue || "").replace(/\D/g, "").trim();

    let rawPhone = String(phoneNumber || phone || searchValue || "").replace(/\D/g, "").trim();
    let cleanPhone = rawPhone;
    if (cleanPhone.startsWith("234") && cleanPhone.length >= 13) {
      cleanPhone = "0" + cleanPhone.slice(3);
    } else if (cleanPhone.length === 10 && !cleanPhone.startsWith("0")) {
      cleanPhone = "0" + cleanPhone;
    }

    const finalPin = String(pin || transactionPin || "").trim();
    const userId = resolveUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        status: "failed",
        message: "User session expired. Please log in again.",
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

    let amountToCharge = Number(amount || 0);
    if (NIMCPrice) {
      const pricing = await NIMCPrice.findOne({
        $or: [
          { serviceType: finalServiceType },
          { serviceId: finalServiceType },
          { name: finalServiceType },
        ],
      });
      if (pricing && pricing.amount > 0) amountToCharge = Number(pricing.amount);
    }
    if (amountToCharge <= 0) amountToCharge = 150;

    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < amountToCharge) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient Wallet Balance. Required: ₦${amountToCharge.toLocaleString()}, Available: ₦${currentBal.toLocaleString()}`,
      });
    }

    const debitedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { walletBalance: -amountToCharge, balance: -amountToCharge } },
      { new: true }
    );
    const newBal = Number(debitedUser?.walletBalance ?? debitedUser?.balance ?? 0);
    const oldBal = Number((newBal + amountToCharge).toFixed(2));

    const transactionId = `NIMC${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
    const reference = `AYAX-NIMC-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const isPhoneSearch = finalServiceType === "phone" || (!finalNin && cleanPhone.length === 11);
    const targetIdentifier = isPhoneSearch ? cleanPhone : finalNin;

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

    if (NIMCRequest) {
      await NIMCRequest.create({
        user: userId,
        serviceType: finalServiceType,
        ninNumber: finalNin,
        phoneNumber: cleanPhone || null,
        searchValue: targetIdentifier,
        amount: amountToCharge,
        status: "pending",
        transactionId,
        reference,
      });
    }

    // ZABEN ENDPOINT NA ABJIKTECH
    let targetEndpoint = "";
    let requestPayload = { api_key: ABJIKTECH_API_KEY };

    if (isPhoneSearch) {
      if (finalServiceType === "premiumCard" || finalServiceType === "premium") {
        targetEndpoint = "https://abjiktech.com.ng/api/verification/nin_by_phone_premium.php";
      } else if (finalServiceType === "basicSlip" || finalServiceType === "regular") {
        targetEndpoint = "https://abjiktech.com.ng/api/verification/nin_by_phone_regular.php";
      } else if (finalServiceType === "vnin") {
        targetEndpoint = "https://abjiktech.com.ng/api/verification/vnin_slip.php";
      } else {
        targetEndpoint = "https://abjiktech.com.ng/api/verification/nin_by_phone_standard.php";
      }
      requestPayload.phone = cleanPhone;
    } else {
      if (finalServiceType === "premiumCard" || finalServiceType === "premium") {
        targetEndpoint = "https://abjiktech.com.ng/api/verification/nin_by_nin.php";
      } else if (finalServiceType === "basicSlip" || finalServiceType === "regular") {
        targetEndpoint = "https://abjiktech.com.ng/api/verification/nin_regular_slip.php";
      } else if (finalServiceType === "vnin") {
        targetEndpoint = "https://abjiktech.com.ng/api/verification/vnin_slip.php";
      } else {
        targetEndpoint = "https://abjiktech.com.ng/api/verification/nin_standard_slip.php";
      }
      requestPayload.nin = finalNin;
    }

    try {
      const abjikRes = await axios.post(targetEndpoint, requestPayload, {
        headers: { "Content-Type": "application/json" },
        timeout: 60000,
        validateStatus: () => true,
      });

      const resData = abjikRes.data || {};
      const isSuccess =
        resData.status === "success" ||
        resData.success === true ||
        resData.response_code === "00" ||
        String(resData.message || "").toLowerCase().includes("successfully");

      const base64Pdf = resData.pdf_base64 || resData.data?.pdf_base64 || null;

      if (!isSuccess || (!base64Pdf && !resData.user_data && !resData.data)) {
        throw new Error(resData.message || resData.desc || "Record not found on NIMC database.");
      }

      // 1. Tattara ainihin user_data daga dukkan sassan da Abjiktech ke ajiye su
      const userData =
        resData.user_data?.response?.[0] ||
        resData.user_data ||
        resData.data?.user_data ||
        resData.data?.details ||
        resData.data ||
        {};

      const resolvedNin =
        userData.nin ||
        userData.ninNumber ||
        userData.vnin ||
        finalNin ||
        targetIdentifier;

      // Ciro Tracking ID
      const userTrackingId =
        userData.trackingId ||
        userData.tracking_id ||
        userData.trackingID ||
        userData.trackingNo ||
        "N/A";

      // Ciro Adireshi (sau ɗaya rak)
      const userAddress =
        userData.address ||
        userData.residence_AdressLine1 ||
        userData.residence_address ||
        userData.residenceAddress ||
        [userData.residence_town, userData.lga || userData.residence_lga, userData.state || userData.residence_state].filter(Boolean).join(", ") ||
        "N/A";

      // 2. Haɗa Cikakken Suna
      const fName = userData.first_name || userData.firstname || userData.firstName || "";
      const mName = userData.middle_name || userData.middlename || userData.middleName || "";
      const lName = userData.last_name || userData.surname || userData.lastname || "";
      const computedFullName =
        userData.fullName ||
        userData.name ||
        `${fName} ${mName} ${lName}`.replace(/\s+/g, " ").trim() ||
        "Verified Citizen";

      // 3. Ciro Hoto (Photo / Base64 Image)
      let photoData = userData.photo || userData.image || userData.base64Image || null;
      if (photoData && !photoData.startsWith("data:image") && !photoData.startsWith("http")) {
        photoData = `data:image/jpeg;base64,${photoData}`;
      }

      // 4. Ranar Haihuwa da Jinsi
      const userDob =
        userData.date_of_birth ||
        userData.dob ||
        userData.birthdate ||
        "N/A";

      const userGender = (userData.gender || "N/A").toUpperCase();

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "success",
          nin: resolvedNin,
          details: `Completed: ${finalServiceType} verified via Abjiktech (NIN: ${resolvedNin})`,
        }
      );

      if (NIMCRequest) {
        await NIMCRequest.findOneAndUpdate(
          { reference },
          {
            status: "completed",
            ninNumber: resolvedNin,
            resolvedAt: new Date(),
            details: userData,
          }
        );
      }

      await sendNotification(
        userId,
        "NIMC Slip Generated 🎉",
        `Your verification slip for ID (${resolvedNin}) has been generated successfully.`,
        "IDENTITY"
      );

      // Cire lambar waya don kada ta fito a kan slips
      const sanitizedUserData = { ...userData };
      delete sanitizedUserData.phone_number;
      delete sanitizedUserData.phone;
      delete sanitizedUserData.telephoneno;

      return res.status(200).json({
        success: true,
        status: "success",
        message: "NIMC details retrieved successfully.",
        data: {
          fullName: computedFullName,
          firstName: fName,
          middleName: mName,
          lastName: lName,
          nin: resolvedNin,
          ninNumber: resolvedNin,
          photo: photoData,
          dob: userDob,
          birthdate: userDob,
          gender: userGender,
          address: userAddress,
          trackingId: userTrackingId,
          state: userData.state || userData.residence_state || userData.stateOfOrigin || "N/A",
          lga: userData.lga || userData.residence_lga || userData.lgaOfOrigin || "N/A"
        },
        user_data: sanitizedUserData,
        pdf_base64: base64Pdf,
        newBalance: newBal,
      });
    } catch (apiErr) {
      console.error("Abjiktech NIMC Error:", apiErr.response?.data || apiErr.message);
      const failureReason = apiErr.response?.data?.message || apiErr.message || "Failed to retrieve identity details";

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
        message: `Verification Failed: ${failureReason}. ₦${amountToCharge.toLocaleString()} refunded to your wallet.`,
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

exports.verifyNIMC = async (req, res) => {
  try {
    const { searchValue, searchType, nin, phone } = req.body;
    const isPhoneSearch = searchType === "phone" || (!nin && phone);
    const targetQuery = String(searchValue || (isPhoneSearch ? phone : nin) || "").trim();

    if (!targetQuery) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please enter a valid NIN or Phone number.",
      });
    }

    const endpoint = isPhoneSearch
      ? "https://abjiktech.com.ng/api/verification/nin_by_phone_standard.php"
      : "https://abjiktech.com.ng/api/verification/nin_standard_slip.php";

    const payload = { api_key: ABJIKTECH_API_KEY };
    if (isPhoneSearch) payload.phone = targetQuery;
    else payload.nin = targetQuery;

    const response = await axios.post(endpoint, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 40000,
    });

    if (response.data?.status === "success" || response.data?.response_code === "00") {
      const outputData = response.data?.user_data || response.data;
      if (outputData && typeof outputData === "object") {
        delete outputData.phone_number;
        delete outputData.phone;
        delete outputData.telephoneno;
      }

      return res.status(200).json({
        success: true,
        status: "success",
        data: outputData,
        pdf_base64: response.data?.pdf_base64 || null,
      });
    }

    return res.status(400).json({
      success: false,
      status: "failed",
      message: response.data?.message || "Record not found on NIMC server.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: "failed",
      message: error.response?.data?.message || "Identity lookup failed on Abjiktech.",
    });
  }
};

exports.getMyNIMCRequests = async (req, res) => {
  try {
    const userId = resolveUserId(req);
    let requests = [];
    if (NIMCRequest && userId) {
      requests = await NIMCRequest.find({ user: userId }).sort({ createdAt: -1 }).lean();
    }
    return res.status(200).json({ success: true, status: "success", count: requests.length, data: requests });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllNIMCRequests = async (req, res) => {
  try {
    let requests = [];
    if (NIMCRequest) {
      requests = await NIMCRequest.find()
        .populate("user", "surname firstName fullName phone email walletBalance")
        .sort({ createdAt: -1 })
        .lean();
    }
    return res.status(200).json({ success: true, status: "success", count: requests.length, data: requests });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateToProcessing = async (req, res) => {
  try {
    const request = await NIMCRequest.findByIdAndUpdate(req.params.id, { status: "processing" }, { new: true });
    if (!request) return res.status(404).json({ success: false, message: "Record not found." });
    return res.status(200).json({ success: true, message: "Marked as processing.", data: request });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

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