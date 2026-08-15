const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");

const AYAX_API_BASE_URL = process.env.AYAX_API_BASE_URL || "https://api.ayaxapis.com/v1";
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
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields (electricCompany, meterNo, meterType)" });
  }

  try {
    const userId = req.user ? (req.user._id || req.user.id) : null;
    
    const response = await axios.post(
      `${AYAX_API_BASE_URL}/electricity/verify`,
      {
        company: electricCompany,
        meter_number: meterNo,
        meter_type: meterType,
      },
      {
        headers: {
          Authorization: `Bearer ${AYAX_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 25000,
      }
    );

    const resData = response.data;
    const isSuccessful = resData && (resData.status === true || resData.status === "success" || resData.code === "200");

    if (isSuccessful) {
      const customerInfo = resData.data || resData;

      if (userId) {
        await Activity.create({
          staffId: userId,
          action: "METER_VERIFIED",
          details: `Verified meter ${meterNo} (${electricCompany}) - Name: ${customerInfo.customerName || customerInfo.name}`,
          targetUser: userId,
        });
      }

      return res.status(200).json({ 
        success: true, 
        customerName: customerInfo.customerName || customerInfo.name,
        address: customerInfo.address || "",
        meterNo,
        electricCompany 
      });
    } else {
      return res.status(400).json({
        success: false,
        message: resData.message || "Invalid Meter Number or Company",
      });
    }
  } catch (error) {
    console.error("Meter Verification Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Meter verification service unavailable via Ayax APIs",
      error: error.message,
    });
  }
};

// 2. Process Electricity Payment via Ayax APIs
exports.buyElectricity = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const { electricCompany, meterNo, meterType, amount, phoneNo } = req.body;
    const userId = req.user._id || req.user.id;

    if (!electricCompany || !meterNo || !meterType || !amount || !phoneNo) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields (electricCompany, meterNo, meterType, amount, phoneNo)",
      });
    }

    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const currentBal = user.walletBalance !== undefined ? user.walletBalance : (user.balance || 0);
    const amountNum = Number(amount);

    if (currentBal < amountNum) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ 
        success: false, 
        message: `Insufficient Wallet Balance. Required: ₦${amountNum}, Available: ₦${currentBal}` 
      });
    }

    const transactionId = `ELEC${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const reference = `AYAX-ELEC-${Date.now()}`;

    // 1. Cire kudi nan take daga Wallet (Atomic Update)
    const newBal = Number((currentBal - amountNum).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save({ session });

    // 2. Ajiye transaction a matsayin 'pending'
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

    // 3. Kira Ayax Electricity API Gateway
    let response;
    try {
      response = await axios.post(
        `${AYAX_API_BASE_URL}/electricity/purchase`,
        {
          company: electricCompany,
          meter_number: meterNo,
          meter_type: meterType,
          amount: amountNum,
          phone: phoneNo,
          ref_id: reference,
        },
        {
          headers: {
            Authorization: `Bearer ${AYAX_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 40000,
        },
      );
    } catch (apiError) {
      console.error("Ayax Electricity API Network Error:", apiError.message);
      
      // REFUND LOGIC: Idan network ya fadi, a mayar wa da user kudin sa
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + amountNum).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      await Transaction.findOneAndUpdate(
        { reference },
        { status: "failed", refundReason: "Gateway connection error", details: "Failed & Refunded due to network error" }
      );

      return res.status(502).json({
        success: false,
        message: "Failed to connect to Ayax electricity provider. Your money has been refunded.",
      });
    }

    const resData = response.data;
    const isSuccessful = resData && (resData.status === true || resData.status === "success" || resData.code === "200");

    if (isSuccessful) {
      const providerData = resData.data || resData;

      await Transaction.findOneAndUpdate(
        { reference },
        { 
          status: "success", 
          reference: providerData.orderid || providerData.reference || reference,
          details: `Success: Electricity token generated for ${meterNo}` 
        }
      );

      // 4. Rubuta Activity Log
      await Activity.create({
        staffId: userId,
        action: "ELECTRICITY_PURCHASED",
        details: `Purchased electricity worth ₦${amountNum} for meter ${meterNo}`,
        targetUser: userId,
      });

      // 5. Tura Sanarwa (Notification)
      const tokenValue = providerData.token || providerData.metertoken || "Generated / Sent via SMS";
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
      // REFUND LOGIC: Idan Ayax API ta ki amincewa da trans din
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + amountNum).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      await Transaction.findOneAndUpdate(
        { reference },
        { status: "failed", refundReason: resData.message || "Provider declined", details: "Failed & Refunded" }
      );

      return res.status(400).json({
        success: false,
        message: resData.message || "Ayax electricity provider declined transaction. Money refunded.",
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