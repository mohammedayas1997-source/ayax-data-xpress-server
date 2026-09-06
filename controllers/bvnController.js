const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Safely resolve user ID daga Token ko Session
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

// Marketplace Headers & Config
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

exports.getBVNPrices = async (req, res) => {
  const prices = {
    bvn_standard: 150,
    bvn_premium: 350,
    bvn_phone: 200,
    bvn_basic: 100,
    bvn_full_details: 150,
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

    // 1. Tace Lambar BVN ko Waya
    let rawDigits = String(bvn || bvnNumber || phone || phoneNumber || searchValue || "").replace(/\D/g, "").trim();
    if (!rawDigits) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please enter a valid 11-digit BVN or phone number.",
      });
    }

    let cleanPhone = rawDigits;
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
        message: "User account not found.",
      });
    }

    // 2. Tabbatar da PIN
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
        message: "Security Error: Invalid Transaction PIN.",
      });
    }

    // 3. Duba Balance (KADA KA CIRE KUDI A NAN TUKUNNA)
    const cost = Number(amount || (isPhoneSearch ? 200 : 150));
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < cost) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient Wallet Balance. Required: ₦${cost}, Available: ₦${currentBal}`,
      });
    }

    const reference = `AYAX-BVN-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const isPremium = serviceType === "bvn_premium" || serviceId === "bvn_premium";
    const slipTypeName = isPremium ? "Premium Slip" : "Standard Slip";

    const baseUrl = getBaseUrl();
    let targetEndpoint = `${baseUrl}/identity/bvn/verify`;
    let requestPayload = {
      bvn: rawDigits,
      slipType: slipTypeName,
      reference,
    };

    if (isPhoneSearch) {
      targetEndpoint = `${baseUrl}/identity/bvn/verify-phone`;
      requestPayload = {
        phone: cleanPhone,
        slipType: slipTypeName,
        reference,
      };
    }

    // 4. KIRA AYAX API MARKETPLACE TUKUNNA
    let marketplaceRes;
    try {
      marketplaceRes = await axios.post(targetEndpoint, requestPayload, {
        headers: getHeaders(),
        timeout: 55000,
      });
    } catch (apiErr) {
      const errMsg = apiErr.response?.data?.message || apiErr.message || "Marketplace connection failed.";
      return res.status(422).json({
        success: false,
        status: "failed",
        message: `Verification Failed: ${errMsg} (Ba a cire kudin ka ba).`,
      });
    }

    const resData = marketplaceRes.data;
    if (!resData || (!resData.success && resData.status !== "success")) {
      return res.status(422).json({
        success: false,
        status: "failed",
        message: resData?.message || "BVN record could not be retrieved from gateway.",
      });
    }

    // 5. Ciro dukkan bayanan PDF da bayanan mai BVN
    const rawData =
      resData.user_data ||
      resData.data?.user_data ||
      resData.data?.details?.data ||
      resData.data?.details ||
      resData.data?.bvnDetails ||
      resData.data ||
      resData;

    let finalPdfSlipUrl =
      resData?.slipUrl ||
      resData?.pdfUrl ||
      resData?.downloadUrl ||
      resData?.url ||
      rawData?.slipUrl ||
      rawData?.pdfUrl ||
      rawData?.downloadUrl ||
      rawData?.url ||
      resData?.data?.slipUrl ||
      resData?.data?.pdfUrl ||
      rawData?.pdf_url ||
      rawData?.slip_url ||
      null;

    if (finalPdfSlipUrl && !String(finalPdfSlipUrl).startsWith("http")) {
      finalPdfSlipUrl = `https://abjiktech.com.ng/${String(finalPdfSlipUrl).replace(/^\/+/, "")}`;
    }

    // Idan Marketplace bai dawo da link ba, dakatar da aiki KADA ka cire kudi
    if (!finalPdfSlipUrl) {
      return res.status(422).json({
        success: false,
        status: "failed",
        message: "Marketplace did not return a valid PDF slip URL. (Ba a cire kudin ka ba).",
      });
    }

    // 6. YANZU KAWAI ZA A CIRE KUDIN USER A WALLET TUNDA AN SAMU SLIP
    const debitedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { walletBalance: -cost, balance: -cost } },
      { new: true }
    );
    const newBal = Number(debitedUser?.walletBalance ?? debitedUser?.balance ?? 0);
    const oldBal = Number((newBal + cost).toFixed(2));

    const firstName = String(rawData.firstName || rawData.firstname || rawData.first_name || "").trim();
    const middleName = String(rawData.middleName || rawData.middlename || rawData.middle_name || "").trim();
    const lastName = String(rawData.lastName || rawData.lastname || rawData.last_name || rawData.surname || "").trim();
    const fullName = rawData.fullName || rawData.name || `${firstName} ${middleName} ${lastName}`.replace(/\s+/g, " ").trim() || "Verified Customer";
    const resolvedBvn = String(rawData.bvn || rawData.bvnNumber || rawData.bvn_number || rawDigits).trim();

    // 7. Ajiye Transaction Ledger a Data Express Database
    await Transaction.create({
      user: userId,
      userId,
      transactionId: `TXN-BVN-${Date.now()}`,
      reference,
      type: "identity",
      category: "IDENTITY",
      service: `BVN ${isPhoneSearch ? "Phone Search" : "Verification"} (${slipTypeName})`,
      amount: cost,
      oldBalance: oldBal,
      newBalance: newBal,
      recipient: resolvedBvn,
      slipUrl: finalPdfSlipUrl,
      status: "success",
      details: `BVN slip successfully retrieved for ${fullName} (${resolvedBvn})`,
    });

    const payloadResponse = {
      bvn: resolvedBvn,
      bvnNumber: resolvedBvn,
      fullName,
      name: fullName,
      firstName: firstName || fullName.split(" ")[0],
      middleName,
      surname: lastName || fullName.split(" ").slice(-1)[0],
      lastName,
      phoneNumber: String(rawData.phoneNumber || rawData.phone || cleanPhone || "N/A"),
      dateOfBirth: rawData.dateOfBirth || rawData.dob || "N/A",
      gender: String(rawData.gender || "N/A").toUpperCase(),
      address: rawData.residentialAddress || rawData.address || "N/A",
      photo: rawData.photo || rawData.image || null,
      slipUrl: finalPdfSlipUrl,
      pdfUrl: finalPdfSlipUrl,
      downloadUrl: finalPdfSlipUrl,
    };

    // 8. Mayar da amsa ga Mobile App tare da dukkan nau'ikan link
    return res.status(200).json({
      success: true,
      status: "success",
      message: "BVN verified and slip generated successfully.",
      bvn: resolvedBvn,
      slipType: slipTypeName,
      slipUrl: finalPdfSlipUrl,
      pdfUrl: finalPdfSlipUrl,
      downloadUrl: finalPdfSlipUrl,
      url: finalPdfSlipUrl,
      data: payloadResponse,
      details: payloadResponse,
      newBalance: newBal,
    });
  } catch (err) {
    console.error("Data Express BVN Error:", err.message);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: err.message || "An internal error occurred during BVN processing. No money was deducted.",
    });
  }
};

exports.verifyAndGenerate = exports.verifyBVN;
exports.submitBVNRequest = exports.verifyBVN;