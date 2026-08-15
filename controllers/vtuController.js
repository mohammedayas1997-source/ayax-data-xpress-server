const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");
const DataPlan = require("../models/DataPlan");
const Sale = require("../models/Sale");
const NIMCRequest = require("../models/NIMCRequest");
const axios = require("axios");

const AYAX_API_BASE_URL = process.env.AYAX_API_BASE_URL || "https://api.ayaxapis.com/v1";
const AYAX_API_KEY = process.env.AYAX_API_KEY;

/**
 * @desc    Purchase Mobile Data with Ayax APIs & Agent Target Tracking
 * @route   POST /api/v1/vtu/buy-data
 * @access  Private
 */
exports.buyData = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const { network, planId, phoneNumber } = req.body;
    const userId = req.user._id;

    if (!network || !planId || !phoneNumber) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Please provide network, planId, and phoneNumber",
      });
    }

    const [user, plan] = await Promise.all([
      User.findById(userId).session(session),
      DataPlan.findOne({
        networkId: String(network),
        planCode: String(planId),
      }),
    ]);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!plan) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "Invalid data plan selected" });
    }

    const finalPrice = user.role === "agent" ? plan.agentPrice : plan.userPrice;
    const currentBal = user.walletBalance !== undefined ? user.walletBalance : (user.balance || 0);

    if (currentBal < finalPrice) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ success: false, message: `Insufficient wallet balance. Required: ₦${finalPrice}, Available: ₦${currentBal}` });
    }

    const transactionId = `DATA${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const reference = `AYAX-DATA-${Date.now()}`;

    // 1. Cire kudi kai tsaye daga wallet (Atomic Update)
    const newBal = Number((currentBal - finalPrice).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save({ session });

    // 2. Ajiye transaction a matsayin "pending"
    const transaction = new Transaction({
      user: user._id,
      transactionId,
      reference,
      type: "data",
      category: "data",
      amount: finalPrice,
      oldBalance: currentBal,
      newBalance: newBal,
      phoneNumber,
      status: "pending",
      details: `Ayax Data Purchase: ${plan.planLabel} for ${phoneNumber}`,
    });
    await transaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    // 3. Kira Ayax APIs
    let response;
    try {
      response = await axios.post(
        `${AYAX_API_BASE_URL}/vtu/data`,
        {
          network,
          plan: planId,
          phone: phoneNumber,
          ref_id: reference,
        },
        {
          headers: {
            Authorization: `Bearer ${AYAX_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        },
      );
    } catch (apiError) {
      console.error("Ayax Data API Network Error:", apiError.message);
      
      // REFUND LOGIC: Idan waje ya fadi, a mayar wa da user kudin sa
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + finalPrice).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      await Transaction.findOneAndUpdate(
        { reference },
        { status: "failed", refundReason: "Gateway connection error", details: "Failed & Refunded due to network error" }
      );

      return res.status(502).json({
        success: false,
        message: "Failed to connect to Ayax data provider network. Your money has been refunded.",
      });
    }

    const resData = response.data;
    const isSuccessful = resData && (resData.status === true || resData.status === "success" || resData.code === "200");

    if (isSuccessful) {
      await Transaction.findOneAndUpdate(
        { reference },
        { status: "success", details: `Success: ${resData.message || plan.planLabel}` }
      );

      // 4. Idan Agent ne, a rubuta Sale domin Target Tracking
      if (user.role === "agent" && user.assignedSupervisor) {
        await Sale.create({
          agentId: user._id,
          supervisorId: user.assignedSupervisor,
          dataAmountGB: Number(plan.sizeGB) || 0,
          planName: plan.planLabel,
          amount: finalPrice,
          transactionRef: transaction._id,
        });
      }

      // 5. Rubuta Activity & Notification
      await Activity.create({
        staffId: user._id,
        action: "BUY_DATA",
        details: `Purchased ${plan.planLabel} data for ${phoneNumber} at ₦${finalPrice}`,
        targetUser: user._id,
      });

      await Notification.create({
        recipient: user._id,
        title: "Data Purchase Successful",
        message: `You have successfully sent ${plan.planLabel} to ${phoneNumber}. Amount: ₦${finalPrice}`,
        type: "vtu",
      });

      return res.status(200).json({
        success: true,
        message: `Successfully sent ${plan.planLabel} to ${phoneNumber}`,
        data: {
          transactionId: transaction.transactionId,
          newBalance: user.walletBalance,
        },
      });
    } else {
      // REFUND LOGIC: Idan Ayax ta ki amincewa da request din
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + finalPrice).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      await Transaction.findOneAndUpdate(
        { reference },
        { status: "failed", refundReason: resData.message || "Provider declined", details: "Failed & Refunded" }
      );

      return res.status(400).json({
        success: false,
        message: resData.message || "Ayax data provider declined the transaction. Money refunded.",
      });
    }
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("Buy Data Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal transaction error",
      error: error.message,
    });
  }
};

/**
 * @desc    Purchase Mobile Airtime via Ayax APIs
 * @route   POST /api/v1/vtu/buy-airtime
 * @access  Private
 */
exports.buyAirtime = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const { network, phoneNumber, amount } = req.body;
    const userId = req.user._id;

    if (!network || !phoneNumber || !amount) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Please provide network, phoneNumber, and amount",
      });
    }

    const amountNum = Number(amount);
    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const currentBal = user.walletBalance !== undefined ? user.walletBalance : (user.balance || 0);

    if (currentBal < amountNum) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ success: false, message: `Insufficient wallet balance. Required: ₦${amountNum}, Available: ₦${currentBal}` });
    }

    const transactionId = `AIR${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const reference = `AYAX-AIR-${Date.now()}`;

    const newBal = Number((currentBal - amountNum).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save({ session });

    const transaction = new Transaction({
      user: userId,
      transactionId,
      reference,
      type: "airtime",
      category: "airtime",
      amount: amountNum,
      oldBalance: currentBal,
      newBalance: newBal,
      phoneNumber,
      status: "pending",
      details: `Ayax Airtime: ₦${amountNum} for ${phoneNumber}`,
    });
    await transaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    let response;
    try {
      response = await axios.post(
        `${AYAX_API_BASE_URL}/vtu/airtime`,
        {
          network,
          amount: amountNum,
          phone: phoneNumber,
          ref_id: reference,
        },
        {
          headers: {
            Authorization: `Bearer ${AYAX_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        },
      );
    } catch (apiError) {
      console.error("Ayax Airtime API Network Error:", apiError.message);
      
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + amountNum).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      await Transaction.findOneAndUpdate(
        { reference },
        { status: "failed", refundReason: "Gateway connection error" }
      );

      return res.status(502).json({
        success: false,
        message: "Failed to connect to Ayax airtime provider. Money refunded.",
      });
    }

    const resData = response.data;
    const isSuccessful = resData && (resData.status === true || resData.status === "success" || resData.code === "200");

    if (isSuccessful) {
      await Transaction.findOneAndUpdate(
        { reference },
        { status: "success", details: `Success: ₦${amountNum} airtime sent to ${phoneNumber}` }
      );

      await Activity.create({
        staffId: user._id,
        action: "BUY_AIRTIME",
        details: `Purchased ₦${amountNum} airtime for ${phoneNumber}`,
        targetUser: user._id,
      });

      await Notification.create({
        recipient: user._id,
        title: "Airtime Purchase Successful",
        message: `Successfully purchased ₦${amountNum} airtime for ${phoneNumber}`,
        type: "vtu",
      });

      return res.status(200).json({ 
        success: true, 
        message: "Airtime purchase successful",
        data: { transactionId: transaction.transactionId, newBalance: user.walletBalance }
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
        { status: "failed", refundReason: resData.message || "Provider declined" }
      );

      return res.status(400).json({
        success: false,
        message: resData.message || "Ayax airtime provider error. Money refunded.",
      });
    }
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("Buy Airtime Error:", error);
    return res.status(500).json({ success: false, message: "Airtime processing error", error: error.message });
  }
};

/**
 * @desc    NIMC Identity Validation via Ayax APIs
 * @route   POST /api/v1/vtu/nimc-validation
 * @access  Private
 */
exports.nimcValidation = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const { nin } = req.body;
    if (!nin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Please provide NIN" });
    }

    const cost = 1000;
    const user = await User.findById(req.user._id).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const currentBal = user.walletBalance !== undefined ? user.walletBalance : (user.balance || 0);

    if (currentBal < cost) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Insufficient balance (₦1,000 required, Available: ₦${currentBal})`,
      });
    }

    const transactionId = `NIMC${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const reference = `AYAX-NIMC-${Date.now()}`;

    const newBal = Number((currentBal - cost).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save({ session });

    await session.commitTransaction();
    session.endSession();

    let response;
    try {
      response = await axios.post(
        `${AYAX_API_BASE_URL}/verification/nimc`,
        { nin, ref_id: reference },
        {
          headers: {
            Authorization: `Bearer ${AYAX_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 40000,
        },
      );
    } catch (apiError) {
      console.error("Ayax NIMC API Error:", apiError.message);
      
      const refundUser = await User.findById(req.user._id);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + cost).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      return res.status(502).json({
        success: false,
        message: "Failed to connect to Ayax NIMC verification gateway. Money refunded.",
      });
    }

    const resData = response.data;
    if (resData && (resData.status === true || resData.status === "success" || resData.code === "200")) {
      const slipDetails = resData.data || resData.slip_details;

      await NIMCRequest.create({
        user: user._id,
        ninNumber: nin,
        transactionId,
        reference,
        status: "completed",
        amount: cost,
        details: slipDetails,
      });

      await Transaction.create({
        user: user._id,
        transactionId,
        reference,
        type: "nimc_validation",
        category: "identity",
        amount: cost,
        oldBalance: currentBal,
        newBalance: newBal,
        status: "success",
        details: { nin, service: "Ayax NIMC Verification" },
      });

      await Activity.create({
        staffId: user._id,
        action: "NIMC_VALIDATION",
        details: `Successfully verified NIN: ${nin}`,
        targetUser: user._id,
      });

      return res.status(200).json({
        success: true,
        data: slipDetails,
        newBalance: user.walletBalance,
      });
    } else {
      const refundUser = await User.findById(req.user._id);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + cost).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      return res.status(400).json({
        success: false,
        message: resData.message || "Ayax NIMC Verification Failed. Money refunded.",
      });
    }
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("NIMC Validation Error:", error);
    return res.status(500).json({ success: false, message: "NIMC service error", error: error.message });
  }
};

/**
 * @desc    Get Transaction History for Logged-in User
 * @route   GET /api/v1/vtu/transactions
 * @access  Private
 */
exports.getTransactionHistory = async (req, res) => {
  try {
    const transactions = await Transaction.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.status(200).json({ success: true, count: transactions.length, data: transactions });
  } catch (error) {
    console.error("Get Transaction History Error:", error);
    return res.status(500).json({ success: false, message: "Could not fetch history", error: error.message });
  }
};

/**
 * @desc    Get Transaction Status by Reference
 * @route   GET /api/v1/vtu/transaction-status/:reference
 * @access  Private
 */
exports.getTransactionStatus = async (req, res) => {
  try {
    const { reference } = req.params;
    const transaction = await Transaction.findOne({
      $or: [{ reference }, { transactionId: reference }],
    }).lean();

    if (!transaction) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }

    return res.status(200).json({
      success: true,
      status: transaction.status,
      data: transaction,
    });
  } catch (error) {
    console.error("Get Transaction Status Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Utility Placeholders (Electricity & Cable TV)
exports.verifyMeter = async (req, res) => {
  res.status(200).json({ success: true, message: "Meter verification placeholder", customerName: "Test Customer" });
};
exports.purchaseElectricity = async (req, res) => {
  res.status(400).json({ success: false, message: "Electricity purchase logic via Ayax APIs coming soon" });
};
exports.verifySmartCard = async (req, res) => {
  res.status(200).json({ success: true, message: "SmartCard verification placeholder", customerName: "Test Customer" });
};
exports.purchaseCable = async (req, res) => {
  res.status(400).json({ success: false, message: "Cable purchase logic via Ayax APIs coming soon" });
};