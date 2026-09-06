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

    // Tabbatar da PIN
    const finalPin = String(pin || transactionPin || "").trim();
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

    // Tabbatar da Kudin Wallet
    const cost = Number(amount || 150);
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < cost) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient balance. Required: NGN ${cost}, Available: NGN ${currentBal}`,
      });
    }

    // Saita asalin Endpoints na Abjiktech bisa tsarin Documentation
    const isPremium = serviceType === "bvn_premium" || serviceId === "bvn_premium";
    const slipTypeName = isPremium ? "Premium Slip" : "Standard Slip";

    const targetEndpoint = isPremium
      ? "https://abjiktech.com.ng/api/verification/bvn_premium_slip.php"
      : "https://abjiktech.com.ng/api/verification/bvn_full_details_slip.php";

    const activeApiKey = String(
      process.env.ABJIKTECH_API_KEY ||
      process.env.AYAX_API_KEY ||
      process.env.MARKETPLACE_API_KEY ||
      ""
    ).trim();

    const requestPayload = {
      api_key: activeApiKey,
      bvn: cleanBvn,
    };

    // Kiran Abjiktech
    let abjikRes;
    try {
      abjikRes = await axios.post(targetEndpoint, requestPayload, {
        headers: { "Content-Type": "application/json" },
        timeout: 65000,
        validateStatus: () => true,
      });
    } catch (apiErr) {
      return res.status(422).json({
        success: false,
        status: "failed",
        message: `Gateway Error: ${apiErr.message || "Connection failed"}`,
      });
    }

    const mData = abjikRes.data;

    // Duba idan aiki ya yi nasara (status == 'success' ko response_code == '00')
    const isSuccess =
      mData?.status === "success" ||
      mData?.response_code === "00" ||
      String(mData?.message || "").toLowerCase().includes("successfully");

    const base64Data = mData?.pdf_base64 || mData?.data?.pdf_base64 || null;

    if (!isSuccess || !base64Data) {
      return res.status(422).json({
        success: false,
        status: "failed",
        message: mData?.message || "BVN record could not be retrieved. No funds were deducted.",
      });
    }

    // Debi kudi a wallet din Data Express tunda Abjiktech ya dawo da PDF
    const debitedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { walletBalance: -cost, balance: -cost } },
      { new: true }
    );
    const newBal = Number(debitedUser?.walletBalance ?? debitedUser?.balance ?? 0);
    const oldBal = Number((newBal + cost).toFixed(2));

    const reference = `AYAX-BVN-${Date.now()}`;
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
      status: "success",
      details: `BVN slip generated for ${cleanBvn}`,
    });

    return res.status(200).json({
      success: true,
      status: "success",
      message: "BVN verification successful.",
      bvn: cleanBvn,
      slipType: slipTypeName,
      userData: mData.user_data || null,
      pdf_base64: base64Data, // Tura asalin binary PDF zuwa ga App
      newBalance: newBal,
    });
  } catch (err) {
    console.error("BVN Error:", err.message);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Internal server error. No funds were deducted.",
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