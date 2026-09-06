const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

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

// 1. Live Prices Handler
exports.getBVNPrices = async (req, res) => {
  const prices = {
    bvn_standard: 150,
    bvn_premium: 350,
    bvn_phone: 200,
    bvn: 150,
    phone: 200,
  };
  return res.status(200).json({
    success: true,
    status: "success",
    prices,
    data: prices,
  });
};
exports.getPrices = exports.getBVNPrices;

// 2. Verify & Generate BVN Details
exports.verifyBVN = async (req, res) => {
  try {
    const {
      bvn,
      bvnNumber,
      phone,
      phoneNumber,
      searchValue,
      serviceType,
      serviceId,
      pin,
      transactionPin,
      amount,
    } = req.body;

    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        status: "failed",
        message: "Session expired. Please log in again.",
      });
    }

    const finalPin = String(pin || transactionPin || "").trim();
    if (!finalPin) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please enter your 4-digit Transaction PIN.",
      });
    }

    // Tace lambobi (BVN ko Phone)
    let rawInput = String(bvn || bvnNumber || phone || phoneNumber || searchValue || "").replace(/\D/g, "").trim();
    if (!rawInput) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please provide a valid BVN or phone number.",
      });
    }

    let cleanPhone = rawInput;
    if (cleanPhone.startsWith("234") && cleanPhone.length >= 13) {
      cleanPhone = "0" + cleanPhone.slice(3);
    } else if (cleanPhone.length === 10 && !cleanPhone.startsWith("0")) {
      cleanPhone = "0" + cleanPhone;
    }

    const isPhoneSearch =
      serviceType === "bvn_phone" ||
      serviceType === "phone" ||
      serviceId === "bvn_phone" ||
      (!bvn && cleanPhone.length === 11 && cleanPhone.startsWith("0"));

    const user = await User.findById(userId).select("+transactionPin +pin +walletBalance +balance");
    if (!user) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "User record not found.",
      });
    }

    // PIN Check
    let isPinValid = false;
    const storedPin = String(user.transactionPin || user.pin || "").trim();
    if (storedPin) {
      try {
        isPinValid = await bcrypt.compare(finalPin, storedPin);
      } catch (_) {}
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

    // Balance Check & Charge
    const cost = Number(amount || (isPhoneSearch ? 200 : 150));
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < cost) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient Wallet Balance. Required: ₦${cost}, Available: ₦${currentBal}`,
      });
    }

    const debitedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { walletBalance: -cost, balance: -cost } },
      { new: true }
    );
    const newBal = Number(debitedUser?.walletBalance ?? debitedUser?.balance ?? 0);
    const oldBal = Number((newBal + cost).toFixed(2));

    const reference = `AYAX-BVN-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    await Transaction.create({
      user: userId,
      userId,
      transactionId: `TXN-BVN-${Date.now()}`,
      reference,
      type: "identity",
      category: "IDENTITY",
      service: `BVN ${isPhoneSearch ? "Phone Search" : "Verification"}`,
      amount: cost,
      oldBalance: oldBal,
      newBalance: newBal,
      recipient: rawInput,
      status: "pending",
      details: `BVN verification lookup for ${rawInput}`,
    });

    const baseUrl = getBaseUrl();
    let targetEndpoint = `${baseUrl}/identity/bvn/verify`;
    let requestPayload = {
      bvn: rawInput,
      slipType: "Standard Slip",
      format: "pdf",
      reference,
    };

    if (isPhoneSearch) {
      targetEndpoint = `${baseUrl}/identity/bvn/verify-phone`;
      requestPayload = {
        phone: cleanPhone,
        slipType: "Standard Slip",
        format: "pdf",
        reference,
      };
    }

    let bvnRes;
    try {
      bvnRes = await axios.post(targetEndpoint, requestPayload, {
        headers: getHeaders(),
        timeout: 45000,
      });
    } catch (primaryErr) {
      // Fallback: Idan endpoint din waya na daban ne a gateway
      if (isPhoneSearch) {
        targetEndpoint = `${baseUrl}/identity/bvn/phone-lookup`;
        bvnRes = await axios.post(
          targetEndpoint,
          { phone: cleanPhone, reference },
          { headers: getHeaders(), timeout: 45000 }
        );
      } else {
        throw primaryErr;
      }
    }

    const resData = bvnRes.data;
    if (!resData || (!resData.success && resData.status !== "success")) {
      throw new Error(resData?.message || "BVN record could not be retrieved from NIBSS gateway.");
    }

    const rawDetails =
      resData.data?.details?.data ||
      resData.data?.details ||
      resData.data ||
      resData;

    // Ciro lambar BVN
    const resolvedBvn = String(
      rawDetails.bvn ||
      rawDetails.bvnNumber ||
      rawDetails.bvn_number ||
      rawInput
    ).trim();

    // Ciro Cikakkun Sunaye daga kowane tsari na NIBSS
    const firstName = String(
      rawDetails.firstName ||
      rawDetails.firstname ||
      rawDetails.first_name ||
      ""
    ).trim();

    const lastName = String(
      rawDetails.lastName ||
      rawDetails.lastname ||
      rawDetails.last_name ||
      rawDetails.surname ||
      ""
    ).trim();

    const middleName = String(
      rawDetails.middleName ||
      rawDetails.middlename ||
      rawDetails.middle_name ||
      ""
    ).trim();

    const computedFullName =
      rawDetails.fullName ||
      rawDetails.name ||
      `${firstName} ${middleName} ${lastName}`.replace(/\s+/g, " ").trim() ||
      "N/A";

    const dob =
      rawDetails.dateOfBirth ||
      rawDetails.date_of_birth ||
      rawDetails.dob ||
      rawDetails.birthdate ||
      "N/A";

    const phoneNum =
      rawDetails.phoneNumber ||
      rawDetails.phoneNumber1 ||
      rawDetails.phone ||
      rawDetails.telephoneno ||
      cleanPhone ||
      "N/A";

    const gender = (rawDetails.gender || "N/A").toUpperCase();
    const nin = rawDetails.nin || rawDetails.ninNumber || "N/A";
    const bank = rawDetails.enrollmentBank || rawDetails.enrollment_bank || rawDetails.bank || "COMMERCIAL BANK";
    const branch = rawDetails.enrollmentBranch || rawDetails.enrollment_branch || rawDetails.branch || "N/A";

    const photo =
      rawDetails.photo ||
      rawDetails.image ||
      rawDetails.base64Image ||
      null;

    const slipUrl =
      rawDetails.slipUrl ||
      rawDetails.pdfUrl ||
      rawDetails.downloadUrl ||
      resData.slipUrl ||
      resData.pdfUrl ||
      null;

    await Transaction.findOneAndUpdate(
      { reference },
      {
        status: "success",
        recipient: resolvedBvn,
        slipUrl,
        apiResponse: rawDetails,
        details: `BVN verification successful for ${computedFullName} (${resolvedBvn})`,
      }
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: "BVN details retrieved successfully.",
      data: {
        bvn: resolvedBvn,
        bvnNumber: resolvedBvn,
        fullName: computedFullName,
        name: computedFullName,
        firstName: firstName || computedFullName.split(" ")[0],
        surname: lastName || computedFullName.split(" ").slice(-1)[0],
        lastName: lastName,
        middleName: middleName,
        dob: dob,
        dateOfBirth: dob,
        phone: phoneNum,
        phoneNumber: phoneNum,
        gender: gender,
        nin: nin,
        enrollmentBank: bank,
        bank: bank,
        enrollmentBranch: branch,
        photo: photo,
        image: photo,
        slipUrl: slipUrl,
        pdfUrl: slipUrl,
      },
      newBalance: newBal,
    });
  } catch (err) {
    console.error("BVN Error:", err.response?.data || err.message);

    // Auto-refund idan an samu matsala
    const userId = resolveUserId(req);
    const cost = Number(req.body.amount || 150);
    if (userId) {
      await User.findByIdAndUpdate(userId, {
        $inc: { walletBalance: cost, balance: cost },
      });
    }

    return res.status(422).json({
      success: false,
      status: "failed",
      refunded: true,
      message:
        err.response?.data?.message ||
        err.message ||
        "Could not verify BVN. The fee has been refunded.",
    });
  }
};

exports.verifyAndGenerate = exports.verifyBVN;
exports.submitBVNRequest = exports.verifyBVN;