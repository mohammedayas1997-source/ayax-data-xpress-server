const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const bcrypt = require("bcryptjs");

// Live API Key Backup (idan process.env.AYAX_API_KEY bai loda ba)
const FALLBACK_API_KEY =
  "ayax_live_13e936ef28c32f2b9d99f2974949e411608490dc069de75ad06f165251eb5345";

// Helper don tura sanarwa (Notification)
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

/**
 * @desc    Sayen Airtime (VTU) via Ayax API Marketplace
 * @route   POST /api/v1/airtime/buy (ko /api/v1/vtu/airtime)
 * @access  Private (User)
 */
exports.buyAirtime = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const { network, phone, phoneNo, phoneNumber, amount, pin } = req.body;
    const userId = req.user._id || req.user.id;

    const targetPhone = String(phone || phoneNo || phoneNumber || "").trim();
    const finalNetwork = String(network || "").trim().toLowerCase();
    const amountNum = Number(amount);

    // 1. Validation
    if (!finalNetwork || !targetPhone || !amountNum) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Please provide network, phone number, and amount",
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

    if (amountNum < 50) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Minimum airtime purchase is ₦50.00",
      });
    }

    const user = await User.findById(userId)
      .select("+pin +transactionPin +walletBalance balance")
      .session(session);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // 2. Tabbatar da PIN
    let isPinValid = false;
    if (user.matchPin) {
      isPinValid = await user.matchPin(pin);
    } else if (user.pin) {
      isPinValid = user.pin === pin || (await bcrypt.compare(pin, user.pin));
    } else {
      isPinValid = pin === "0000";
    }

    if (!isPinValid) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Security Error: Invalid Transaction PIN",
      });
    }

    // 3. Duba Wallet Balance
    const currentBal =
      user.walletBalance !== undefined ? user.walletBalance : user.balance || 0;

    if (currentBal < amountNum) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Insufficient Wallet Balance. Required: ₦${amountNum}, Available: ₦${currentBal}`,
      });
    }

    const transactionId = `AIRT${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const reference = `AYAX-AIRT-${Date.now()}`;

    // 4. Cire Kudi daga Wallet nan take (Atomic Debit)
    const newBal = Number((currentBal - amountNum).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save({ session });

    // 5. Ajiye Transaction History a matsayin 'pending'
    const newTransaction = new Transaction({
      user: userId,
      transactionId,
      reference,
      type: "airtime",
      category: "vtu",
      amount: amountNum,
      oldBalance: currentBal,
      newBalance: newBal,
      status: "pending",
      details: `${finalNetwork.toUpperCase()} ₦${amountNum} Airtime Recharge for ${targetPhone}`,
    });
    await newTransaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    // 6. Saita URL da API Key a Runtime
    const activeApiKey = (
      process.env.AYAX_API_KEY || FALLBACK_API_KEY
    ).trim();

    const rawBaseUrl =
      process.env.AYAX_API_BASE_URL ||
      "https://ayax-api-marketplace.onrender.com";

    const cleanBaseUrl = rawBaseUrl
      .replace(/\/+$/, "")
      .replace(/\/api\/v1\/?$/, "");

    const targetUrl = `${cleanBaseUrl}/api/v1/airtime/buy`;

    let response;
    try {
      console.log(`[VTU AIRTIME] Calling Marketplace: ${targetUrl}`);
      console.log(`[VTU AIRTIME] Using Key Prefix: ${activeApiKey.substring(0, 14)}...`);

      response = await axios.post(
        targetUrl,
        {
          network: finalNetwork,
          phone: targetPhone,
          amount: amountNum,
          reference: reference,
        },
        {
          headers: {
            "x-api-key": activeApiKey,
            Authorization: `Bearer ${activeApiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 45000,
        }
      );
    } catch (apiError) {
      console.error(
        "Ayax Airtime API Full Error:",
        apiError.response?.data || apiError.message
      );

      // AUTO-REFUND: Mayar da kudi idan kiran gateway ya fadi
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number(
          ((refundUser.walletBalance || 0) + amountNum).toFixed(2)
        );
        if (refundUser.balance !== undefined)
          refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      const errMsg =
        apiError.response?.data?.message ||
        apiError.response?.data?.error ||
        apiError.message ||
        "Gateway connection error";

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
        message: `Failed to connect to Ayax airtime provider (${errMsg}). Money refunded.`,
      });
    }

    const resData = response.data;
    const isSuccessful =
      resData &&
      (resData.success === true ||
        resData.status === "success" ||
        resData.status === "SUCCESSFUL");

    if (isSuccessful) {
      const providerData = resData.data || resData;

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "success",
          reference:
            providerData.reference || providerData.orderId || reference,
          details: `Success: ${finalNetwork.toUpperCase()} ₦${amountNum} Airtime to ${targetPhone}`,
        }
      );

      await Activity.create({
        staffId: userId,
        action: "AIRTIME_PURCHASED",
        details: `Purchased ${finalNetwork.toUpperCase()} ₦${amountNum} airtime for ${targetPhone}`,
        targetUser: userId,
      });

      await sendNotification(
        userId,
        "Airtime Recharge Successful",
        `Your ${finalNetwork.toUpperCase()} airtime recharge of ₦${amountNum} to ${targetPhone} was successful.`
      );

      return res.status(200).json({
        success: true,
        message: "Airtime Recharge Successful",
        orderId: providerData.reference || reference,
        network: finalNetwork,
        phone: targetPhone,
        amount: amountNum,
        newBalance: user.walletBalance,
      });
    } else {
      // Auto Refund idan provider ya ki amincewa da siyan
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number(
          ((refundUser.walletBalance || 0) + amountNum).toFixed(2)
        );
        if (refundUser.balance !== undefined)
          refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      const failReason =
        resData.message || "Provider declined transaction";

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "failed",
          refundReason: failReason,
          details: `Failed & Refunded: ${failReason}`,
        }
      );

      return res.status(400).json({
        success: false,
        message: `${failReason}. Money refunded.`,
      });
    }
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("Buy Airtime System Error:", error);
    return res.status(500).json({
      success: false,
      message: "Airtime processing error",
      error: error.message,
    });
  }
};