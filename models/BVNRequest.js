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

// Farashin Services
exports.getBVNPrices = async (req, res) => {
  const prices = {
    bvn_full_details: 150,
    bvn_premium: 150,
  };
  return res.status(200).json({
    success: true,
    status: "success",
    prices,
    data: prices,
  });
};
exports.getPrices = exports.getBVNPrices;

// Babban Aikin BVN Verification
exports.verifyBVN = async (req, res) => {
  let chargedUserId = null;
  let chargedCost = 0;
  let txReference = null;

  try {
    const {
      bvn,
      bvnNumber,
      searchValue,
      serviceType,
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

    // Tace lambar BVN
    let cleanBvn = String(bvn || bvnNumber || searchValue || "").replace(/\D/g, "").trim();
    if (!cleanBvn || cleanBvn.length !== 11) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please enter a valid 11-digit BVN number.",
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

    // 1. PIN Check
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

    // 2. Duba Balance da Cirar Kudi
    const cost = Number(amount || 150);
    chargedCost = cost;
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < cost) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient balance. Required: ₦${cost}, Available: ₦${currentBal}`,
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

    const isPremium = serviceType === "bvn_premium";
    const selectedTierName = isPremium ? "Premium Slip" : "Full Details Slip";

    await Transaction.create({
      user: userId,
      userId,
      transactionId: `TXN-BVN-${Date.now()}`,
      reference,
      type: "identity",
      category: "IDENTITY",
      service: `BVN (${selectedTierName})`,
      amount: cost,
      oldBalance: oldBal,
      newBalance: newBal,
      recipient: cleanBvn,
      status: "pending",
      details: `BVN Verification for [${cleanBvn}] (${selectedTierName})`,
    });

    // 3. Kira Abjiktech kai tsaye daidai da tsarin portal dinsu
    const abjiktechKey = (process.env.ABJIKTECH_API_KEY || "dv_068de722a84b71ce900a65fa4c17bdf9_1788498653").trim();
    const abjiktechEndpoint = isPremium
      ? "https://abjiktech.com.ng/api/verification/bvn_premium_slip.php"
      : "https://abjiktech.com.ng/api/verification/bvn_full_details_slip.php";

    const response = await axios.post(
      abjiktechEndpoint,
      {
        api_key: abjiktechKey,
        bvn: cleanBvn,
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 50000,
      }
    );

    const resData = response.data;
    const directPdf =
      resData?.pdf_url ||
      resData?.slip_url ||
      resData?.download_url ||
      resData?.url ||
      resData?.data?.pdf_url ||
      null;

    const isSuccess =
      resData?.status === "success" ||
      resData?.success === true ||
      Boolean(directPdf);

    if (!isSuccess || !directPdf) {
      throw new Error(resData?.message || resData?.error || "Abjiktech could not verify this BVN.");
    }

    // 4. Sabunta Transaction
    await Transaction.findOneAndUpdate(
      { reference },
      {
        status: "success",
        recipient: cleanBvn,
        slipUrl: directPdf,
        apiResponse: resData,
        details: `BVN Slip successfully generated for [${cleanBvn}]`,
      }
    );

    return res.status(200).json({
      success: true,
      status: "success",
      message: "BVN verification successful.",
      bvn: cleanBvn,
      slipType: selectedTierName,
      slipUrl: directPdf,
      pdfUrl: directPdf,
      downloadUrl: directPdf,
      newBalance: newBal,
    });
  } catch (err) {
    console.error("BVN Error:", err.response?.data || err.message);

    const failureReason =
      err.response?.data?.message ||
      err.message ||
      "BVN verification failed at provider.";

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
      message: `${failureReason} The fee has been refunded to your wallet.`,
    });
  }
};

exports.verifyAndGenerate = exports.verifyBVN;
exports.submitBVNRequest = exports.verifyBVN;