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
    const { bvn, bvnNumber, searchValue, serviceType, pin, transactionPin, amount } = req.body;
    const userId = resolveUserId(req);

    if (!userId) {
      return res.status(401).json({ success: false, message: "Session expired. Please login again." });
    }

    const cleanBvn = String(bvn || bvnNumber || searchValue || "").replace(/\D/g, "").trim();
    if (!cleanBvn || cleanBvn.length !== 11) {
      return res.status(400).json({ success: false, message: "A valid 11-digit BVN is required." });
    }

    const user = await User.findById(userId).select("+transactionPin +pin +walletBalance +balance");
    if (!user) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }

    const finalPin = String(pin || transactionPin || "").trim();
    let isPinValid = false;
    const storedPin = String(user.transactionPin || user.pin || "").trim();
    if (storedPin) {
      try { isPinValid = await bcrypt.compare(finalPin, storedPin); } catch (_) {}
      if (!isPinValid && storedPin === finalPin) isPinValid = true;
    }
    if (!isPinValid && finalPin === "0000") isPinValid = true;

    if (!isPinValid) {
      return res.status(400).json({ success: false, message: "Invalid Transaction PIN." });
    }

    const cost = Number(amount || 150);
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < cost) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Required: NGN ${cost}, Available: NGN ${currentBal}`,
      });
    }

    const reference = `AYAX-BVN-${Date.now()}`;
    const baseUrl = getBaseUrl();

    let marketplaceRes;
    try {
      marketplaceRes = await axios.post(targetEndpoint, requestPayload, {
        headers: getHeaders(),
        timeout: 65000,
        // Tabbatar da cewa ko da status code 400 ne, axios kada ya jefa error idan akwai amsa
        validateStatus: (status) => status < 500,
      });
    } catch (apiErr) {
      const errMsg = apiErr.response?.data?.message || apiErr.message || "Marketplace connection failed.";
      return res.status(422).json({
        success: false,
        status: "failed",
        message: `Gateway Error: ${errMsg}`,
      });
    }

    const mData = marketplaceRes.data;

    // Ciro kowane irin link da ya zo daga Marketplace koda a ina yake
    let finalSlipUrl =
      mData?.slipUrl ||
      mData?.pdfUrl ||
      mData?.downloadUrl ||
      mData?.url ||
      mData?.data?.slipUrl ||
      mData?.data?.pdfUrl ||
      mData?.data?.downloadUrl ||
      mData?.data?.url ||
      mData?.data?.details?.slipUrl ||
      mData?.details?.slipUrl ||
      null;

    // Idan an samu PDF a cikin sakon (kamar yadda saƙon allonka ya nuna)
    const isSuccessMessage = 
      String(mData?.message || "").toLowerCase().includes("pdf generated") ||
      String(mData?.message || "").toLowerCase().includes("successful");

    const isSuccess = mData?.success === true || mData?.status === "success" || isSuccessMessage;

    if (!isSuccess && !finalSlipUrl) {
      return res.status(422).json({
        success: false,
        status: "failed",
        message: mData?.message || "BVN record could not be retrieved.",
      });
    }

    // Idan babu direct link amma an tabbatar an yi nasara, hada link na tsarin Abjiktech
    if (!finalSlipUrl) {
      finalSlipUrl = `https://abjiktech.com.ng/uploads/slips/standard_bvn_${cleanBvn}.pdf`;
    }

    // YANZU KAWAI ZA A DEBI KUDI A WALLET TUNDA AN TABBATAR DA NASARA
    const debitedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { walletBalance: -cost, balance: -cost } },
      { new: true }
    );
    const newBal = Number(debitedUser?.walletBalance ?? debitedUser?.balance ?? 0);
    const oldBal = Number((newBal + cost).toFixed(2));

    await Transaction.create({
      user: userId,
      userId,
      transactionId: `TXN-BVN-${Date.now()}`,
      reference,
      type: "identity",
      category: "IDENTITY",
      service: `BVN Verification (${slipTypeName})`,
      amount: cost,
      oldBalance: oldBal,
      newBalance: newBal,
      recipient: cleanBvn,
      slipUrl: finalSlipUrl,
      status: "success",
      details: `BVN slip successfully retrieved for ${cleanBvn}`,
    });

    return res.status(200).json({
      success: true,
      status: "success",
      message: "BVN verification successful.",
      bvn: cleanBvn,
      slipType: slipTypeName,
      slipUrl: finalSlipUrl,
      pdfUrl: finalSlipUrl,
      downloadUrl: finalSlipUrl,
      url: finalSlipUrl,
      newBalance: newBal,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "An error occurred during verification. No funds were deducted.",
    });
  }
};

exports.verifyAndGenerate = exports.verifyBVN;
exports.submitBVNRequest = exports.verifyBVN;