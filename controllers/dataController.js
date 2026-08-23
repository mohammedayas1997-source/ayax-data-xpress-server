const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const bcrypt = require("bcryptjs");

// Live API Key Backup
const FALLBACK_API_KEY =
  "ayax_live_13e936ef28c32f2b9d99f2974949e411608490dc069de75ad06f165251eb5345";

// Helper don tura Notification
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
 * @desc    Sayen Data Bundle (VTU) via Ayax API Marketplace
 * @route   POST /api/v1/vtu/buy-data (ko /api/v1/data/buy)
 * @access  Private (User)
 */
exports.buyData = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const { network, phone, phoneNumber, phoneNo, planCode, amount, transactionPin, pin } = req.body;
    const userId = req.user._id || req.user.id;

    const targetPhone = String(phoneNumber || phone || phoneNo || "").trim();
    const finalNetwork = String(network || "").trim().toUpperCase();
    const cleanPlanCode = String(planCode || "1000").trim();
    const amountNum = Number(amount);
    const userPin = String(transactionPin || pin || "").trim();

    // 1. Validation
    if (!finalNetwork || !targetPhone || !cleanPlanCode) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Please provide network, recipient phone number, and plan code",
      });
    }

    if (!userPin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Transaction PIN is required",
      });
    }

    if (!amountNum || amountNum <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Invalid data plan amount",
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
      isPinValid = await user.matchPin(userPin);
    } else if (user.pin) {
      isPinValid = user.pin === userPin || (await bcrypt.compare(userPin, user.pin));
    } else {
      isPinValid = userPin === "0000";
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

    const transactionId = `DATA${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const reference = `AYAX-DATA-${Date.now()}`;

    // 4. Cire Kudi daga Wallet nan take (Atomic Debit)
    const newBal = Number((currentBal - amountNum).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save({ session });

    // 5. Ajiye Transaction History
    const newTransaction = new Transaction({
      user: userId,
      transactionId,
      reference,
      type: "data",
      category: "vtu",
      amount: amountNum,
      oldBalance: currentBal,
      newBalance: newBal,
      status: "pending",
      details: `${finalNetwork} (${cleanPlanCode}) Data Bundle for ${targetPhone}`,
    });
    await newTransaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    // 6. Saita URL da API Key a Runtime (Marketplace Forwarding)
    const activeApiKey = (
      process.env.AYAX_API_KEY || FALLBACK_API_KEY
    ).trim();

    const rawBaseUrl =
      process.env.AYAX_API_BASE_URL ||
      "https://ayax-api-marketplace.onrender.com";

    const cleanBaseUrl = rawBaseUrl
      .replace(/\/+$/, "")
      .replace(/\/api\/v1\/?$/, "");

    // Endpoint na Marketplace Data Purchase
    const targetUrl = `${cleanBaseUrl}/api/v1/data/purchase`;

    let response;
    try {
      console.log(`[VTU DATA] Calling Marketplace: ${targetUrl}`);
      console.log(`[VTU DATA] Dispatched Ref: ${reference} (${finalNetwork} ${cleanPlanCode}) -> ${targetPhone}`);

      response = await axios.post(
        targetUrl,
        {
          network: finalNetwork,
          phone: targetPhone,
          phoneNumber: targetPhone,
          planCode: cleanPlanCode,
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
        "Ayax Data API Full Error:",
        apiError.response?.data || apiError.message
      );

      // AUTO-REFUND: Mayar da kudi idan Marketplace ta kasa turawa
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
        message: `Failed to connect to Ayax data provider (${errMsg}). Money refunded.`,
      });
    }

    const resData = response.data;
    const isSuccessful =
      resData &&
      (resData.success === true ||
        resData.status === "success" ||
        resData.status === "SUCCESSFUL" ||
        resData.code === "TRANSACTION_QUEUED");

    if (isSuccessful) {
      const providerData = resData.data || resData;

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "success",
          reference: providerData.reference || providerData.orderId || reference,
          details: `Success: ${finalNetwork} Data (${cleanPlanCode}) to ${targetPhone}`,
        }
      );

      await Activity.create({
        user: user._id,
        staffId: user._id,
        action: "BUY_DATA",
        details: `Purchased ${finalNetwork} (${cleanPlanCode}) data for ${targetPhone}`,
        targetUser: user._id,
      }).catch((err) => console.warn("Activity log error:", err.message));

      await sendNotification(
        userId,
        "Data Bundle Successful 🎉",
        `Your ${finalNetwork} data bundle purchase for ${targetPhone} was processed successfully.`
      );

      return res.status(200).json({
        success: true,
        message: "Data Purchase Dispatched Successfully",
        orderId: providerData.reference || reference,
        network: finalNetwork,
        phone: targetPhone,
        amount: amountNum,
        newBalance: user.walletBalance,
      });
    } else {
      // Auto Refund idan ba a yi nasara ba
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number(
          ((refundUser.walletBalance || 0) + amountNum).toFixed(2)
        );
        if (refundUser.balance !== undefined)
          refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      const failReason = resData.message || "Provider declined data transaction";

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

    console.error("Buy Data System Error:", error);
    return res.status(500).json({
      success: false,
      message: "Data processing error",
      error: error.message,
    });
  }
};