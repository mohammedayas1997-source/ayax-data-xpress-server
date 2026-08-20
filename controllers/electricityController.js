const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const bcrypt = require("bcryptjs");

const AYAX_API_BASE_URL =
  process.env.AYAX_API_BASE_URL ||
  "https://ayax-api-marketplace.onrender.com/api/v1";
const AYAX_API_KEY = process.env.AYAX_API_KEY;

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
  const { electricCompany, meterNo, meterType } = req.body;

  if (!electricCompany || !meterNo || !meterType) {
    return res.status(400).json({
      success: false,
      message:
        "Missing required fields (electricCompany, meterNo, meterType)",
    });
  }

  try {
    const userId = req.user ? req.user._id || req.user.id : null;

    // Daidaita endpoint zuwa /bills/electricity/verify da x-api-key header
    const response = await axios.post(
      `${AYAX_API_BASE_URL}/bills/electricity/verify`,
      {
        disco: electricCompany.toLowerCase(),
        meterNo: String(meterNo).trim(),
        meterType: String(meterType).toLowerCase(),
      },
      {
        headers: {
          "x-api-key": AYAX_API_KEY,
          Authorization: `Bearer ${AYAX_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 25000,
      }
    );

    const resData = response.data;
    const isSuccessful =
      resData && (resData.success === true || resData.status === "success");

    if (isSuccessful) {
      const customerInfo = resData.data || resData;

      if (userId) {
        await Activity.create({
          staffId: userId,
          action: "METER_VERIFIED",
          details: `Verified meter ${meterNo} (${electricCompany}) - Name: ${
            customerInfo.customerName || customerInfo.name
          }`,
          targetUser: userId,
        });
      }

      return res.status(200).json({
        success: true,
        customerName: customerInfo.customerName || customerInfo.name,
        address: customerInfo.customerAddress || customerInfo.address || "",
        meterNo,
        electricCompany,
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
    const { electricCompany, meterNo, meterType, amount, phoneNo, pin } =
      req.body;
    const userId = req.user._id || req.user.id;

    if (!electricCompany || !meterNo || !meterType || !amount || !phoneNo) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message:
          "Please provide all required fields (electricCompany, meterNo, meterType, amount, phoneNo)",
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

    const user = await User.findById(userId).select("+pin").session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const isPinValid = user.pin
      ? user.pin === pin || (await bcrypt.compare(pin, user.pin))
      : true;
    if (!isPinValid) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Invalid transaction PIN",
      });
    }

    const currentBal =
      user.walletBalance !== undefined
        ? user.walletBalance
        : user.balance || 0;
    const amountNum = Number(amount);

    if (currentBal < amountNum) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Insufficient Wallet Balance. Required: ₦${amountNum}, Available: ₦${currentBal}`,
      });
    }

    const transactionId = `ELEC${Date.now()}${Math.floor(
      Math.random() * 1000
    )}`;
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
      details: `Electricity payment for ${meterNo} (${electricCompany})`,
    });
    await newTransaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    // 3. Kira Sabon Ayax Electricity API Gateway (/bills/electricity/buy)
    let response;
    try {
      response = await axios.post(
        `${AYAX_API_BASE_URL}/bills/electricity/buy`,
        {
          disco: electricCompany.toLowerCase(),
          meterNo: String(meterNo).trim(),
          meterType: String(meterType).toLowerCase(),
          amount: amountNum,
          phone: String(phoneNo).trim(),
          reference: reference,
        },
        {
          headers: {
            "x-api-key": AYAX_API_KEY,
            Authorization: `Bearer ${AYAX_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 40000,
        }
      );
    } catch (apiError) {
      console.error(
        "Ayax Electricity API Error:",
        apiError.response?.data || apiError.message
      );

      // Auto Refund
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number(
          (refundUser.walletBalance + amountNum).toFixed(2)
        );
        if (refundUser.balance !== undefined)
          refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      const errMsg =
        apiError.response?.data?.message || "Gateway connection error";

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
      resData && (resData.success === true || resData.status === "success");

    if (isSuccessful) {
      const providerData = resData.data || resData;

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "success",
          reference:
            providerData.orderid || providerData.reference || reference,
          details: `Success: Electricity token generated for ${meterNo}`,
        }
      );

      await Activity.create({
        staffId: userId,
        action: "ELECTRICITY_PURCHASED",
        details: `Purchased electricity worth ₦${amountNum} for meter ${meterNo}`,
        targetUser: userId,
      });

      const tokenValue =
        providerData.token ||
        providerData.metertoken ||
        "Generated / Sent via SMS";
      await sendNotification(
        userId,
        "Electricity Purchase Successful",
        `Your electricity token purchase of ₦${amountNum} for meter ${meterNo} was successful. Token: ${tokenValue}`
      );

      return res.status(200).json({
        success: true,
        message: "Payment Successful",
        orderId: providerData.orderid || reference,
        token: tokenValue,
        unit: providerData.units || "",
        newBalance: user.walletBalance,
      });
    } else {
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number(
          (refundUser.walletBalance + amountNum).toFixed(2)
        );
        if (refundUser.balance !== undefined)
          refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "failed",
          refundReason: resData.message || "Provider declined",
          details: "Failed & Refunded",
        }
      );

      return res.status(400).json({
        success: false,
        message:
          resData.message ||
          "Ayax electricity provider declined transaction. Money refunded.",
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