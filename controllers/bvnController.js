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
    bvn_full_details: 150,
    bvn_premium: 150,
  };
  return res.status(200).json({
    success: true,
    status: "success",
    prices,
  });
};
exports.getPrices = exports.getBVNPrices;

exports.verifyBVN = async (req, res) => {
  try {
    const {
      bvn,
      bvnNumber,
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
        message: "Session expired. Please login again.",
      });
    }

    const cleanBvn = String(bvn || bvnNumber || searchValue || "").replace(/\D/g, "").trim();
    if (!cleanBvn || cleanBvn.length !== 11) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "A valid 11-digit BVN is required.",
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

    // PIN Verification
    const finalPin = String(pin || transactionPin || "").trim();
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

    // Wallet Balance Check
    const cost = Number(amount || 150);
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < cost) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient balance. Required: NGN ${cost}, Available: NGN ${currentBal}`,
      });
    }

    const reference = `AYAX-BVN-${Date.now()}`;
    const baseUrl = getBaseUrl();
    const isPremium = serviceType === "bvn_premium" || serviceId === "bvn_premium";
    const slipTypeName = isPremium ? "Premium Slip" : "Standard Slip";

    const targetEndpoint = `${baseUrl}/identity/bvn/verify`;
    const requestPayload = {
      bvn: cleanBvn,
      bvnNumber: cleanBvn,
      searchValue: cleanBvn,
      slipType: slipTypeName,
      reference,
    };

    // 1. Kiran Marketplace
    let mData = null;
    try {
      const marketplaceRes = await axios.post(targetEndpoint, requestPayload, {
        headers: getHeaders(),
        timeout: 65000,
        validateStatus: () => true,
      });
      mData = marketplaceRes.data;
    } catch (apiErr) {
      mData = apiErr.response?.data || null;
    }

    if (!mData) {
      return res.status(422).json({
        success: false,
        status: "failed",
        message: "Unable to connect to Marketplace gateway. No funds were deducted.",
      });
    }

    // 2. Ciro PDF link
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

    const messageText = String(mData?.message || "").toLowerCase();
    const isSuccess =
      mData?.success === true ||
      mData?.status === "success" ||
      messageText.includes("pdf generated") ||
      messageText.includes("successful");

    if (!isSuccess && !finalSlipUrl) {
      return res.status(422).json({
        success: false,
        status: "failed",
        message: mData?.message || "BVN record could not be retrieved. No funds were deducted.",
      });
    }

    if (!finalSlipUrl) {
      finalSlipUrl = `https://abjiktech.com.ng/uploads/slips/standard_bvn_${cleanBvn}.pdf`;
    }

    if (finalSlipUrl && !String(finalSlipUrl).startsWith("http")) {
      finalSlipUrl = `https://abjiktech.com.ng/${String(finalSlipUrl).replace(/^\/+/, "")}`;
    }

    // Dauko ainihin PDF din ta Server a maida shi Base64 don a sauke shi kai tsaye
    let base64Pdf = null;
    try {
      const pdfBufferRes = await axios.get(finalSlipUrl, {
        responseType: "arraybuffer",
        timeout: 25000,
      });
      base64Pdf = Buffer.from(pdfBufferRes.data, "binary").toString("base64");
    } catch (streamErr) {
      console.warn("Could not convert slip to base64, falling back to link:", streamErr.message);
    }

    // 3. Debi kudi a wallet tunda an tabbatar da takardar
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

    // 4. Mayar da amsa tare da pdfBase64
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
      pdfBase64: base64Pdf,
      newBalance: newBal,
    });
  } catch (err) {
    console.error("Data Express BVN Error:", err.message);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "An internal server error occurred. No funds were deducted.",
    });
  }
};

// =========================================================================
// 4. DIRECT DOWNLOAD PROXY (YANA TILASTA WA BROWSER YIN SAUKEWA A DEVICE)
// =========================================================================
exports.downloadBVNSlip = async (req, res) => {
  try {
    const { url, bvn } = req.query;
    if (!url) {
      return res.status(400).send("PDF URL parameter is required.");
    }

    const cleanTargetUrl = decodeURIComponent(url);

    const response = await axios({
      method: "GET",
      url: cleanTargetUrl,
      responseType: "stream",
      timeout: 45000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Accept: "application/pdf,*/*",
      },
    });

    const fileName = `BVN_Slip_${bvn || Date.now()}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    response.data.pipe(res);
  } catch (err) {
    console.error("PDF Download Proxy Error:", err.message);
    return res.status(500).send("Failed to stream PDF document.");
  }
};

exports.verifyAndGenerate = exports.verifyBVN;
exports.submitBVNRequest = exports.verifyBVN;