const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const bcrypt = require("bcryptjs");

// 1. Ayax API Gateway Base Configuration
const RAW_URL =
  process.env.AYAX_API_BASE_URL ||
  process.env.MARKETPLACE_API_URL ||
  "https://ayax-api-marketplace.onrender.com";

const CLEAN_BASE = RAW_URL.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
const AYAX_API_BASE_URL = `${CLEAN_BASE}/api/v1`;

const AYAX_API_KEY =
  process.env.AYAX_API_KEY ||
  process.env.MARKETPLACE_API_KEY ||
  "ayax_live_13e936ef28c32f2b9d99f2974949e411608490dc069de75ad06f165251eb5345";

// Ayax Standard API Headers
const getHeaders = () => ({
  "Content-Type": "application/json",
  "x-api-key": AYAX_API_KEY,
  Authorization: `Bearer ${AYAX_API_KEY}`,
});

// Helper don tsara sanarwar App cikin sauki
const sendNotification = async (userId, title, message, category = "VTU_DISPATCH") => {
  try {
    const user = await User.findById(userId);
    if (user) {
      if (!user.notifications) user.notifications = [];
      user.notifications.unshift({
        title,
        message,
        category,
        date: new Date(),
        isRead: false,
      });
      await user.save();
    }
  } catch (error) {
    console.error("Electricity Notification Error:", error.message);
  }
};

/**
 * 1. VERIFY METER NUMBER VIA AYAX API GATEWAY
 * Matches Frontend: DISCO validation & customer lookup
 */
exports.verifyMeter = async (req, res) => {
  const { electricCompany, disco, serviceId, meterNo, meterNumber, meterType } = req.body;
  const finalDisco = String(disco || electricCompany || serviceId || "").toLowerCase().trim();
  const finalMeterNo = String(meterNo || meterNumber || "").trim();
  const finalMeterType = String(meterType || "prepaid").toLowerCase().trim();

  if (!finalDisco || !finalMeterNo) {
    return res.status(400).json({
      success: false,
      status: "failed",
      message: "Please select Electricity Disco and enter Meter Number.",
    });
  }

  try {
    const userId = req.user ? req.user._id || req.user.id : null;

    let response;
    const candidateEndpoints = [
      `${AYAX_API_BASE_URL}/bills/electricity/verify`,
      `${AYAX_API_BASE_URL}/electricity/verify`,
      `${AYAX_API_BASE_URL}/vtu/electricity/verify`,
    ];

    for (const endpoint of candidateEndpoints) {
      try {
        response = await axios.post(
          endpoint,
          {
            disco: finalDisco,
            serviceId: finalDisco,
            meterNo: finalMeterNo,
            meterNumber: finalMeterNo,
            meterType: finalMeterType,
          },
          {
            headers: getHeaders(),
            timeout: 25000,
          }
        );
        if (response.data) break;
      } catch (e) {
        if (endpoint === candidateEndpoints[candidateEndpoints.length - 1]) throw e;
      }
    }

    const resData = response.data;
    const isSuccessful =
      resData &&
      (resData.success === true ||
        resData.status === "success" ||
        resData.status === true ||
        resData.code === 200 ||
        resData.code === "200");

    if (isSuccessful) {
      const customerInfo = resData.data || resData;
      const verifiedName =
        customerInfo.customerName ||
        customerInfo.customer_name ||
        customerInfo.name ||
        customerInfo.accountName ||
        "Verified Customer";

      const verifiedAddress =
        customerInfo.customerAddress ||
        customerInfo.address ||
        customerInfo.customer_address ||
        "N/A";

      if (userId) {
        await Activity.create({
          user: userId,
          staffId: userId,
          action: "METER_VERIFIED",
          category: "VTU",
          details: `Verified meter ${finalMeterNo} (${finalDisco.toUpperCase()}) - Name: ${verifiedName}`,
          targetUser: userId,
        }).catch(() => {});
      }

      return res.status(200).json({
        success: true,
        status: "success",
        customerName: verifiedName,
        name: verifiedName,
        address: verifiedAddress,
        meterNo: finalMeterNo,
        meterNumber: finalMeterNo,
        electricCompany: finalDisco,
        disco: finalDisco,
        meterType: finalMeterType,
      });
    } else {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: resData.message || "Invalid Meter Number or Electricity Company.",
      });
    }
  } catch (error) {
    console.error(
      "Meter Verification Error:",
      error.response?.status,
      error.response?.data || error.message
    );
    return res.status(error.response?.status || 500).json({
      success: false,
      status: "failed",
      message:
        error.response?.data?.message ||
        "Meter verification server unavailable. Please check the number and retry.",
    });
  }
};

/**
 * 2. PROCESS ELECTRICITY PAYMENT & TOKEN DISPATCH VIA AYAX APIS
 * Handles: Pin authorization, Wallet balance verification, Token generation, and Instant automated refund
 */
exports.buyElectricity = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const {
      electricCompany,
      disco,
      serviceId,
      meterNo,
      meterNumber,
      meterType,
      amount,
      phoneNo,
      phone,
      phoneNumber,
      pin,
      transactionPin,
    } = req.body;

    const finalDisco = String(disco || electricCompany || serviceId || "").toLowerCase().trim();
    const finalMeterNo = String(meterNo || meterNumber || "").trim();
    const finalMeterType = String(meterType || "prepaid").toLowerCase().trim();
    const finalPhone = String(phoneNo || phone || phoneNumber || "").trim();
    const finalPin = String(pin || transactionPin || "").trim();
    const amountNum = Number(amount);
    const userId = req.user._id || req.user.id;

    if (!finalDisco || !finalMeterNo || !amountNum || amountNum <= 0 || !finalPhone) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please fill in all details (Disco, Meter Number, Amount, and Phone Number).",
      });
    }

    if (!finalPin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Security transaction PIN is required.",
      });
    }

    const user = await User.findById(userId)
      .select("+transactionPin +pin +walletBalance balance")
      .session(session);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "User account not found." });
    }

    // PIN Authentication Check
    let isPinValid = false;
    if (user.matchPin) {
      isPinValid = await user.matchPin(finalPin);
    } else if (user.transactionPin) {
      isPinValid = String(user.transactionPin) === String(finalPin);
    } else if (user.pin) {
      isPinValid = user.pin === finalPin || (await bcrypt.compare(String(finalPin), user.pin).catch(() => false));
    } else {
      isPinValid = finalPin === "0000";
    }

    if (!isPinValid) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Incorrect transaction PIN.",
      });
    }

    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);

    if (currentBal < amountNum) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient Wallet Balance. Needed: ₦${amountNum.toLocaleString()}, Available: ₦${currentBal.toLocaleString()}`,
      });
    }

    const transactionId = `ELEC${Date.now()}${Math.floor(Math.random() * 10000)}`;
    const reference = `AYAX-ELEC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // 1. Deduct Funds from User Wallet
    const newBal = Number((currentBal - amountNum).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save({ session });

    // 2. Create Pending Transaction Record
    const newTransaction = new Transaction({
      user: userId,
      transactionId,
      reference,
      type: "electricity",
      category: "DEBIT",
      amount: amountNum,
      oldBalance: currentBal,
      newBalance: newBal,
      phoneNumber: finalPhone,
      meterNumber: finalMeterNo,
      provider: finalDisco.toUpperCase(),
      status: "pending",
      details: `Electricity Token for Meter ${finalMeterNo} (${finalDisco.toUpperCase()})`,
    });
    await newTransaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    // 3. Dispatch Live Purchase to Ayax Electricity Gateway
    let response;
    const candidatePurchaseEndpoints = [
      `${AYAX_API_BASE_URL}/bills/electricity/buy`,
      `${AYAX_API_BASE_URL}/electricity/buy`,
      `${AYAX_API_BASE_URL}/vtu/electricity/pay`,
    ];

    try {
      for (const endpoint of candidatePurchaseEndpoints) {
        try {
          response = await axios.post(
            endpoint,
            {
              disco: finalDisco,
              serviceId: finalDisco,
              meterNo: finalMeterNo,
              meterNumber: finalMeterNo,
              meterType: finalMeterType,
              amount: amountNum,
              phone: finalPhone,
              reference: reference,
              ref_id: reference,
            },
            {
              headers: getHeaders(),
              timeout: 45000,
            }
          );
          if (response.data) break;
        } catch (e) {
          if (endpoint === candidatePurchaseEndpoints[candidatePurchaseEndpoints.length - 1]) throw e;
        }
      }
    } catch (apiError) {
      console.error(
        "Ayax Electricity API Connection Failure:",
        apiError.response?.status,
        apiError.response?.data || apiError.message
      );

      // Automated Instant Refund
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + amountNum).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      const errMsg = apiError.response?.data?.message || "Electricity gateway timed out";

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "failed",
          isRefunded: true,
          refundReason: errMsg,
          details: `Failed & Refunded: ${errMsg}`,
        }
      );

      await sendNotification(
        userId,
        "Electricity Purchase Refunded",
        `Your ₦${amountNum.toLocaleString()} payment for meter ${finalMeterNo} failed to generate a token and has been instantly refunded to your wallet.`,
        "REFUND"
      );

      return res.status(502).json({
        success: false,
        status: "failed",
        message: `Failed to generate token (${errMsg}). ₦${amountNum.toLocaleString()} has been refunded to your wallet.`,
      });
    }

    const resData = response.data;
    const isSuccessful =
      resData &&
      (resData.success === true ||
        resData.status === "success" ||
        resData.status === true ||
        resData.code === 200 ||
        resData.code === "200");

    if (isSuccessful) {
      const providerData = resData.data || resData;

      const tokenValue =
        providerData.token ||
        providerData.meterToken ||
        providerData.metertoken ||
        providerData.tokenCode ||
        providerData.mainToken ||
        "Token Generated";

      const unitsValue =
        providerData.units ||
        providerData.unitsPurchased ||
        providerData.unit ||
        "";

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "success",
          token: tokenValue,
          units: unitsValue,
          apiReference: providerData.orderid || providerData.reference || reference,
          apiResponse: providerData,
          details: `Success: Token (${tokenValue}) for Meter ${finalMeterNo}`,
        }
      );

      await Activity.create({
        user: userId,
        staffId: userId,
        action: "ELECTRICITY_PURCHASED",
        category: "VTU",
        details: `Purchased electricity worth ₦${amountNum} for meter ${finalMeterNo} - Token: ${tokenValue}`,
        targetUser: userId,
      }).catch(() => {});

      await sendNotification(
        userId,
        "Electricity Token Generated 🎉",
        `Your electricity purchase of ₦${amountNum.toLocaleString()} for meter ${finalMeterNo} was successful. Token: ${tokenValue} | Units: ${unitsValue}`,
        "ELECTRICITY_TOKEN"
      );

      return res.status(200).json({
        success: true,
        status: "success",
        message: "Electricity token generated successfully.",
        orderId: providerData.orderid || reference,
        reference: reference,
        token: tokenValue,
        unit: unitsValue,
        units: unitsValue,
        newBalance: user.walletBalance,
      });
    } else {
      // Gateway Refusal & Automated Refund
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + amountNum).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      const failureReason = resData?.message || "Ayax provider declined transaction";

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "failed",
          isRefunded: true,
          refundReason: failureReason,
          details: `Declined & Refunded: ${failureReason}`,
        }
      );

      await sendNotification(
        userId,
        "Electricity Purchase Refunded",
        `Your ₦${amountNum.toLocaleString()} electricity attempt for meter ${finalMeterNo} was declined (${failureReason}). Money has been refunded.`,
        "REFUND"
      );

      return res.status(400).json({
        success: false,
        status: "failed",
        message: `${failureReason}. Your wallet balance has been refunded.`,
      });
    }
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("Buy Electricity Processing Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Internal server error occurred while processing electricity payment.",
      error: error.message,
    });
  }
};