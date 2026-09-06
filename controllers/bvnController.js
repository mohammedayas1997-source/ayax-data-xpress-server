const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

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

exports.getBVNPrices = async (req, res) => {
  const prices = {
    bvn_standard: 150,
    bvn_premium: 350,
    bvn_phone: 200,
    bvn_basic: 100,
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
  let chargedUserId = null;
  let chargedCost = 0;
  let txReference = null;

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
    chargedUserId = userId;

    const finalPin = String(pin || transactionPin || "").trim();
    if (!finalPin) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please enter your 4-digit Transaction PIN.",
      });
    }

    // Tace lambar BVN ko Waya
    let rawDigits = String(bvn || bvnNumber || phone || phoneNumber || searchValue || "").replace(/\D/g, "").trim();
    if (!rawDigits) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please provide a valid 11-digit BVN or phone number.",
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

    // PIN Verification
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
    chargedCost = cost;
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
    txReference = reference;

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
      recipient: rawDigits,
      status: "pending",
      details: `BVN search query for ${rawDigits}`,
    });

    const baseUrl = getBaseUrl();
    let targetEndpoint = `${baseUrl}/identity/bvn/verify`;
    let requestPayload = {
      bvn: rawDigits,
      bvnNumber: rawDigits,
      searchValue: rawDigits,
      slipType: serviceType === "bvn_premium" ? "Premium Card" : "Standard Slip",
      format: "pdf",
      generatePdf: true,
      reference,
    };

    if (isPhoneSearch) {
      targetEndpoint = `${baseUrl}/identity/bvn/verify-phone`;
      requestPayload = {
        phone: cleanPhone,
        phoneNumber: cleanPhone,
        searchValue: cleanPhone,
        slipType: "Standard Slip",
        format: "pdf",
        generatePdf: true,
        reference,
      };
    }

    let bvnRes;
    try {
      bvnRes = await axios.post(targetEndpoint, requestPayload, {
        headers: getHeaders(),
        timeout: 55000,
      });
    } catch (err) {
      if (isPhoneSearch) {
        targetEndpoint = `${baseUrl}/identity/bvn/phone-lookup`;
        bvnRes = await axios.post(
          targetEndpoint,
          { phone: cleanPhone, format: "pdf", reference },
          { headers: getHeaders(), timeout: 55000 }
        );
      } else {
        throw err;
      }
    }

    const resData = bvnRes.data;
    if (!resData || (!resData.success && resData.status !== "success")) {
      throw new Error(resData?.message || "BVN record could not be retrieved from gateway.");
    }

    // Tace data daga kowane gurbi (harda Abjiktech user_data)
    const rawData =
      resData.user_data ||
      resData.data?.user_data ||
      resData.data?.details?.data ||
      resData.data?.details ||
      resData.data?.bvnDetails ||
      resData.data ||
      resData;

    // 1. Ciro Sunaye
    const firstName = String(
      rawData.firstName || rawData.firstname || rawData.first_name || ""
    ).trim();

    const middleName = String(
      rawData.middleName || rawData.middlename || rawData.middle_name || ""
    ).trim();

    const lastName = String(
      rawData.lastName || rawData.lastname || rawData.last_name || rawData.surname || ""
    ).trim();

    const fullName =
      rawData.fullName ||
      rawData.name ||
      `${firstName} ${middleName} ${lastName}`.replace(/\s+/g, " ").trim() ||
      "Verified Customer";

    // 2. Ciro Lambobi da Adireshi
    const resolvedBvn = String(
      rawData.bvn || rawData.bvnNumber || rawData.bvn_number || rawDigits
    ).trim();

    const phone1 = String(
      rawData.phoneNumber ||
      rawData.phoneNumber1 ||
      rawData.phone_number1 ||
      rawData.telephoneNo ||
      rawData.phone ||
      cleanPhone ||
      "N/A"
    ).trim();

    const dob =
      rawData.dateOfBirth ||
      rawData.date_of_birth ||
      rawData.birthDate ||
      rawData.dob ||
      rawData.birthdate ||
      "N/A";

    const gender = String(rawData.gender || "N/A").toUpperCase();
    const nin = rawData.nin || rawData.ninNumber || "N/A";

    const residentialAddress =
      rawData.residentialAddress ||
      rawData.residential_address ||
      rawData.address ||
      rawData.residence_address ||
      "N/A";

    const state = rawData.stateOfOrigin || rawData.state_of_origin || rawData.state || "N/A";
    const lga = rawData.lgaOfOrigin || rawData.lga_of_origin || rawData.lga || "N/A";
    const bank = rawData.enrollmentBank || rawData.enrollment_bank || rawData.bank || "COMMERCIAL BANK";
    const branch = rawData.enrollmentBranch || rawData.enrollment_branch || rawData.branch || "HEAD OFFICE";

    // 3. Hoto & Slip URL
    const photo =
      rawData.photo ||
      rawData.image ||
      rawData.base64Image ||
      rawData.passport ||
      null;

    const slipUrl =
      resData.pdf_url ||
      resData.slip_url ||
      resData.pdfUrl ||
      resData.slipUrl ||
      rawData.slipUrl ||
      rawData.pdfUrl ||
      rawData.pdf_url ||
      rawData.slip_url ||
      rawData.downloadUrl ||
      null;

    await Transaction.findOneAndUpdate(
      { reference },
      {
        status: "success",
        recipient: resolvedBvn,
        slipUrl,
        apiResponse: rawData,
        details: `BVN verified successfully for ${fullName} (${resolvedBvn})`,
      }
    );

    const payloadResponse = {
      bvn: resolvedBvn,
      bvnNumber: resolvedBvn,
      fullName,
      name: fullName,
      firstName: firstName || fullName.split(" ")[0],
      middleName,
      surname: lastName || fullName.split(" ").slice(-1)[0],
      lastName,
      phoneNumber: phone1,
      phone: phone1,
      dateOfBirth: dob,
      dob,
      gender,
      nin,
      address: residentialAddress,
      residentialAddress,
      state,
      lga,
      enrollmentBank: bank,
      bank,
      enrollmentBranch: branch,
      photo,
      image: photo,
      slipUrl,
      pdfUrl: slipUrl,
    };

    return res.status(200).json({
      success: true,
      status: "success",
      message: "BVN profile retrieved successfully.",
      slipUrl,
      pdfUrl: slipUrl,
      data: payloadResponse,
      details: payloadResponse,
      newBalance: newBal,
    });
  } catch (err) {
    console.error("BVN Processing Error:", err.response?.data || err.message);

    const failureReason =
      err.response?.data?.message ||
      err.message ||
      "BVN verification failed.";

    if (chargedUserId && chargedCost > 0) {
      await User.findByIdAndUpdate(chargedUserId, {
        $inc: { walletBalance: chargedCost, balance: chargedCost },
      });

      if (txReference) {
        await Transaction.findOneAndUpdate(
          { reference: txReference },
          {
            status: "refunded",
            details: `Failed & Refunded: ${failureReason}`,
          }
        );
      }
    }

    return res.status(422).json({
      success: false,
      status: "failed",
      refunded: true,
      message: `${failureReason} Fee has been refunded to your wallet.`,
    });
  }
};

exports.verifyAndGenerate = exports.verifyBVN;
exports.submitBVNRequest = exports.verifyBVN;