const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const bcrypt = require("bcryptjs");

// 1. Tabbatar da Ingantaccen URL ba tare da maimaita /api/v1 ba
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

// Helper don tsara Headers
const getHeaders = () => ({
  "Content-Type": "application/json",
  "x-api-key": AYAX_API_KEY,
  Authorization: `Bearer ${AYAX_API_KEY}`,
});

// Helper for notifications
const sendNotification = async (userId, title, message) => {
  try {
    const user = await User.findById(userId);
    if (user) {
      if (!user.notifications) user.notifications = [];
      user.notifications.push({
        title,
        message,
        date: new Date(),
        isRead: false,
      });
      await user.save();
    }
  } catch (error) {
    console.error("Notification failed:", error);
  }
};

// 1. Verify Meter Number via Ayax APIs
exports.verifyMeter = async (req, res) => {
  const { electricCompany, disco, meterNo, meterNumber, meterType } = req.body;
  const finalDisco = String(disco || electricCompany || "").toLowerCase().trim();
  const finalMeterNo = String(meterNo || meterNumber || "").trim();
  const finalMeterType = String(meterType || "prepaid").toLowerCase().trim();

  if (!finalDisco || !finalMeterNo) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields (electricCompany/disco, meterNo)",
    });
  }

  try {
    const userId = req.user ? req.user._id || req.user.id : null;

    const response = await axios.post(
      `${AYAX_API_BASE_URL}/bills/electricity/verify`,
      {
        disco: finalDisco,
        meterNo: finalMeterNo,
        meterType: finalMeterType,
      },
      {
        headers: getHeaders(),
        timeout: 25000,
      }
    );

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

      if (userId) {
        await Activity.create({
          staffId: userId,
          action: "METER_VERIFIED",
          details: `Verified meter ${finalMeterNo} (${finalDisco}) - Name: ${
            customerInfo.customerName || customerInfo.name || customerInfo.customer_name
          }`,
          targetUser: userId,
        });
      }

      return res.status(200).json({
        success: true,
        customerName: customerInfo.customerName || customerInfo.name || customerInfo.customer_name || "Verified Customer",
        address: customerInfo.customerAddress || customerInfo.address || "",
        meterNo: finalMeterNo,
        electricCompany: finalDisco,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: resData.message || "Invalid Meter Number or Company",
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
      message:
        error.response?.data?.message ||
        "Meter verification service unavailable via Ayax APIs",
    });
  }
};

// 2. Process Electricity Payment via Ayax APIs
exports.buyElectricity = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const { electricCompany, disco, meterNo, meterNumber, meterType, amount, phoneNo, phone, pin } = req.body;
    const finalDisco = String(disco || electricCompany || "").toLowerCase().trim();
    const finalMeterNo = String(meterNo || meterNumber || "").trim();
    const finalMeterType = String(meterType || "prepaid").toLowerCase().trim();
    const finalPhone = String(phoneNo || phone || "").trim();
    const amountNum = Number(amount);
    const userId = req.user._id || req.user.id;

    if (!finalDisco || !finalMeterNo || !amountNum || amountNum <= 0 || !finalPhone) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields (electricCompany, meterNo, amount, phoneNo)",
      });
    }

    if (!pin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Transaction PIN is required",
      });
    }

    const user = await User.findById(userId).select("+transactionPin +pin +walletBalance balance").session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // PIN Verification
    let isPinValid = false;
    if (user.matchPin) {
      isPinValid = await user.matchPin(pin);
    } else if (user.transactionPin) {
      isPinValid = String(user.transactionPin) === String(pin);
    } else if (user.pin) {
      isPinValid = user.pin === pin || (await bcrypt.compare(String(pin), user.pin).catch(() => false));
    } else {
      isPinValid = pin === "0000";
    }

    if (!isPinValid) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Invalid transaction PIN",
      });
    }

    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);

    if (currentBal < amountNum) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Insufficient Wallet Balance. Required: ₦${amountNum}, Available: ₦${currentBal}`,
      });
    }

    const transactionId = `ELEC${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const reference = `AYAX-ELEC-${Date.now()}`;

    // 1. Cire kudi daga Wallet
    const newBal = Number((currentBal - amountNum).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save({ session });

    // 2. Ajiye transaction
    const newTransaction = new Transaction({
      user: userId,
      transactionId,
      reference,
      type: "electricity",
      category: "utility",
      amount: amountNum,
      oldBalance: currentBal,
      newBalance: newBal,
      status: "pending",
      details: `Electricity payment for ${finalMeterNo} (${finalDisco})`,
    });
    await newTransaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    // 3. Kira Sabon Ayax Electricity API Gateway
    let response;
    try {
      response = await axios.post(
        `${AYAX_API_BASE_URL}/bills/electricity/buy`,
        {
          disco: finalDisco,
          meterNo: finalMeterNo,
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
    } catch (apiError) {
      console.error(
        "Ayax Electricity API Error:",
        apiError.response?.status,
        apiError.response?.data || apiError.message
      );

      // Auto Refund
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + amountNum).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      const errMsg = apiError.response?.data?.message || "Gateway connection error";

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "failed",
          refundReason: errMsg,
          details: `Failed & Refunded: ${errMsg}`,
        }
      );

      return res.status(502).json({
        success: false,
        message: `Failed to connect to Ayax electricity provider (${errMsg}). Your money has been refunded.`,
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

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "success",
          reference: providerData.orderid || providerData.reference || reference,
          details: `Success: Electricity token generated for ${finalMeterNo}`,
        }
      );

      await Activity.create({
        staffId: userId,
        action: "ELECTRICITY_PURCHASED",
        details: `Purchased electricity worth ₦${amountNum} for meter ${finalMeterNo}`,
        targetUser: userId,
      });

      const tokenValue =
        providerData.token ||
        providerData.metertoken ||
        providerData.tokenCode ||
        "Generated / Sent via SMS";

      await sendNotification(
        userId,
        "Electricity Purchase Successful",
        `Your electricity token purchase of ₦${amountNum} for meter ${finalMeterNo} was successful. Token: ${tokenValue}`
      );

      return res.status(200).json({
        success: true,
        message: "Payment Successful",
        orderId: providerData.orderid || reference,
        token: tokenValue,
        unit: providerData.units || providerData.unitsPurchased || "",
        newBalance: user.walletBalance,
      });
    } else {
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + amountNum).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "failed",
          refundReason: resData?.message || "Provider declined",
          details: "Failed & Refunded",
        }
      );

      return res.status(400).json({
        success: false,
        message: resData?.message || "Ayax electricity provider declined transaction. Money refunded.",
      });
    }
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("Buy Electricity Error:", error);
    return res.status(500).json({
      success: false,
      message: "Payment processing error",
      error: error.message,
    });
  }
};