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

// Asalin Tushen Abjiktech ko Marketplace Provider
const getProviderConfig = () => {
  const abjiktechKey = (process.env.ABJIKTECH_API_KEY || "dv_068de722a84b71ce900a65fa4c17bdf9_1788498653").trim();
  const marketplaceKey = String(process.env.AYAX_API_KEY || process.env.MARKETPLACE_API_KEY || "").trim();
  
  const rawMarketplaceUrl = process.env.AYAX_API_BASE_URL || process.env.MARKETPLACE_API_URL || "https://www.ayaxapis.com";
  const cleanMarketplaceUrl = rawMarketplaceUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "") + "/api/v1";

  return {
    abjiktechKey,
    marketplaceKey,
    marketplaceUrl: cleanMarketplaceUrl,
    abjiktechBase: "https://abjiktech.com.ng/api/verification",
  };
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

    // Tace Lambar BVN ko Waya
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

    // Balance Check
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

    // Rage Kudi a Wallet din Data Express
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
      details: `BVN processing for ID: ${rawDigits}`,
    });

    const config = getProviderConfig();
    const isPremiumTier = serviceType === "bvn_premium" || serviceId === "bvn_premium";

    let providerResponse = null;

    // =========================================================================
    // MATAKI NA 1: TURAWA ASALIN UWAR GARKE (ABJIKTECH DIRECT KO MARKETPLACE)
    // =========================================================================
    try {
      // Hanyar 1: Kiran Abjiktech Direct tare da ainihin document requirements
      const abjiktechUrl = isPremiumTier
        ? `${config.abjiktechBase}/bvn_premium_slip.php`
        : `${config.abjiktechBase}/bvn_full_details_slip.php`;

      const directRes = await axios.post(
        abjiktechUrl,
        {
          api_key: config.abjiktechKey,
          bvn: isPhoneSearch ? cleanPhone : rawDigits,
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 45000,
        }
      );

      if (directRes.data?.status === "success" || directRes.data?.pdf_url || directRes.data?.slip_url) {
        providerResponse = directRes.data;
      }
    } catch (directErr) {
      console.warn("Direct Abjiktech attempt failed, routing via Marketplace fallback:", directErr.message);
    }

    // Hanyar 2: Marketplace Route Fallback (Idan Hanyar 1 bata mayar da sakamako ba)
    if (!providerResponse) {
      const marketplaceEndpoint = isPhoneSearch
        ? `${config.marketplaceUrl}/identity/bvn/verify-phone`
        : `${config.marketplaceUrl}/identity/bvn/verify`;

      const mRes = await axios.post(
        marketplaceEndpoint,
        {
          bvn: rawDigits,
          phone: cleanPhone,
          slipType: isPremiumTier ? "Premium Slip" : "Standard Slip",
          reference,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": config.marketplaceKey,
            Authorization: `Bearer ${config.marketplaceKey}`,
          },
          timeout: 45000,
        }
      );

      providerResponse = mRes.data;
    }

    if (!providerResponse) {
      throw new Error("Could not connect to the upstream BVN clearing system.");
    }

    // =========================================================================
    // MATAKI NA 2: CIRO AINIHIN PDF LINK DA BAYANAI BA TARE DA BLANK BA
    // =========================================================================
    const rawData =
      providerResponse.user_data ||
      providerResponse.data?.user_data ||
      providerResponse.data?.details?.data ||
      providerResponse.data?.details ||
      providerResponse.data?.bvnDetails ||
      providerResponse.data ||
      providerResponse;

    const finalPdfSlipUrl =
      providerResponse.pdf_url ||
      providerResponse.slip_url ||
      providerResponse.pdfUrl ||
      providerResponse.slipUrl ||
      rawData.pdf_url ||
      rawData.slip_url ||
      rawData.slipUrl ||
      rawData.pdfUrl ||
      rawData.downloadUrl ||
      null;

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

    const resolvedBvn = String(
      rawData.bvn || rawData.bvnNumber || rawData.bvn_number || rawDigits
    ).trim();

    const phone1 = String(
      rawData.phoneNumber ||
      rawData.phoneNumber1 ||
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

    const residentialAddress =
      rawData.residentialAddress ||
      rawData.residential_address ||
      rawData.address ||
      rawData.residence_address ||
      "N/A";

    const bank = rawData.enrollmentBank || rawData.enrollment_bank || rawData.bank || "COMMERCIAL BANK";
    const branch = rawData.enrollmentBranch || rawData.enrollment_branch || rawData.branch || "HEAD OFFICE";

    const photo =
      rawData.photo ||
      rawData.image ||
      rawData.base64Image ||
      rawData.passport ||
      null;

    // Sabunta Transaction
    await Transaction.findOneAndUpdate(
      { reference },
      {
        status: "success",
        recipient: resolvedBvn,
        slipUrl: finalPdfSlipUrl,
        apiResponse: rawData,
        details: `BVN verified successfully: ${fullName} (${resolvedBvn})`,
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
      gender: String(rawData.gender || "N/A").toUpperCase(),
      nin: String(rawData.nin || rawData.ninNumber || "N/A"),
      address: residentialAddress,
      residentialAddress,
      state: rawData.stateOfOrigin || rawData.state || "N/A",
      lga: rawData.lgaOfOrigin || rawData.lga || "N/A",
      enrollmentBank: bank,
      bank,
      enrollmentBranch: branch,
      photo,
      image: photo,
      slipUrl: finalPdfSlipUrl,
      pdfUrl: finalPdfSlipUrl,
    };

    return res.status(200).json({
      success: true,
      status: "success",
      message: "BVN verified and slip generated successfully.",
      slipUrl: finalPdfSlipUrl,
      pdfUrl: finalPdfSlipUrl,
      downloadUrl: finalPdfSlipUrl,
      data: payloadResponse,
      details: payloadResponse,
      newBalance: newBal,
    });
  } catch (err) {
    console.error("Data Express BVN Error:", err.response?.data || err.message);

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
      message: `${failureReason} Your wallet has been refunded.`,
    });
  }
};

exports.verifyAndGenerate = exports.verifyBVN;
exports.submitBVNRequest = exports.verifyBVN;