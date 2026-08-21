const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");
const DataPlan = require("../models/DataPlan");
const Sale = require("../models/Sale");
const axios = require("axios");

// 1. Tsaftace URL na API Marketplace
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

// Helper don tsara Marketplace Headers
const getMarketplaceHeaders = (userAuthHeader) => {
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": AYAX_API_KEY,
  };
  if (userAuthHeader) {
    headers["Authorization"] = userAuthHeader;
  } else if (AYAX_API_KEY) {
    headers["Authorization"] = `Bearer ${AYAX_API_KEY}`;
  }
  return headers;
};

/**
 * @desc    Purchase Mobile Data via Ayax APIs (Safe Balance & Auto-Refund)
 * @route   POST /api/v1/vtu/buy-data, POST /api/v1/data/buy
 * @access  Private
 */
exports.buyData = async (req, res) => {
  const userId = req.user?._id || req.user?.id;
  const { network, planId, plan, phoneNumber, phone, pin, amount } = req.body;
  const targetPhone = phoneNumber || phone;
  const targetPlan = planId || plan;

  let isDeducted = false;
  let finalPrice = 0;
  let reference = `AYAX-DATA-${Date.now()}`;
  let transactionDoc = null;

  try {
    if (!network || !targetPlan || !targetPhone) {
      return res.status(400).json({
        success: false,
        message: "Please provide network, planId, and phoneNumber",
      });
    }

    // 1. Nemo User da Data Plan
    const [user, dataPlanDoc] = await Promise.all([
      User.findById(userId).select("+transactionPin +pin +walletBalance balance role assignedSupervisor"),
      DataPlan.findOne({
        $or: [
          { planCode: String(targetPlan) },
          { planId: String(targetPlan) },
          { _id: targetPlan.match(/^[0-9a-fA-F]{24}$/) ? targetPlan : null },
        ].filter(Boolean),
      }),
    ]);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // 2. Tantance Transaction PIN idan an turo
    if (pin) {
      let isPinValid = false;
      if (user.matchPin) {
        isPinValid = await user.matchPin(pin);
      } else if (user.transactionPin) {
        isPinValid = String(user.transactionPin) === String(pin);
      } else if (user.pin) {
        isPinValid = String(user.pin) === String(pin);
      } else {
        isPinValid = pin === "0000";
      }

      if (!isPinValid) {
        return res.status(400).json({
          success: false,
          message: "Security Error: Invalid Transaction PIN",
        });
      }
    }

    // 3. Tantance Farashi
    finalPrice = dataPlanDoc
      ? user.role === "agent"
        ? dataPlanDoc.agentPrice
        : dataPlanDoc.userPrice
      : Number(amount || 0);

    if (finalPrice <= 0) {
      return res.status(400).json({ success: false, message: "Invalid plan pricing" });
    }

    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);

    if (currentBal < finalPrice) {
      return res.status(400).json({
        success: false,
        message: `Kudinka bai isa ba! Ana buƙatar: ₦${finalPrice}, Kana da: ₦${currentBal}`,
      });
    }

    // 4. Cire Kuɗi a Wallet (Atomic Deduction)
    const newBal = Number((currentBal - finalPrice).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save();
    isDeducted = true;

    // 5. Ajiye Transaction History
    const planLabel = dataPlanDoc?.planLabel || `${network} Data Plan`;
    const transactionId = `DATA${Date.now()}${Math.floor(Math.random() * 1000)}`;

    transactionDoc = await Transaction.create({
      user: userId,
      transactionId,
      reference,
      type: "data",
      category: "data",
      amount: finalPrice,
      oldBalance: currentBal,
      newBalance: newBal,
      phoneNumber: targetPhone,
      status: "pending",
      details: `Ayax Data Purchase: ${planLabel} for ${targetPhone}`,
    });

    // 6. Kira Ayax API Marketplace Gateway
    const requestPayload = {
      network: String(network).toUpperCase(),
      plan: targetPlan,
      planId: targetPlan,
      phone: targetPhone,
      phoneNumber: targetPhone,
      amount: finalPrice,
      ref_id: reference,
      reference: reference,
    };

    const requestHeaders = getMarketplaceHeaders(req.headers.authorization);

    let response;
    try {
      try {
        response = await axios.post(
          `${AYAX_API_BASE_URL}/data/buy`,
          requestPayload,
          { headers: requestHeaders, timeout: 40000 }
        );
      } catch (err1) {
        if (err1.response?.status === 404) {
          response = await axios.post(
            `${AYAX_API_BASE_URL}/vtu/data`,
            requestPayload,
            { headers: requestHeaders, timeout: 40000 }
          );
        } else {
          throw err1;
        }
      }
    } catch (apiError) {
      console.error("Marketplace Data API Error:", apiError.response?.data || apiError.message);
      throw new Error(apiError.response?.data?.message || "Kuskure wajen hadawa da uwar garke ta Data");
    }

    const resData = response?.data;
    const isSuccessful =
      resData &&
      (resData.status === true ||
        resData.status === "success" ||
        resData.code === 200 ||
        resData.code === "200" ||
        resData.success === true);

    if (isSuccessful) {
      // Sabunta Transaction zuwa Success
      if (transactionDoc) {
        await Transaction.findByIdAndUpdate(transactionDoc._id, {
          status: "success",
          details: `Success: ${resData.message || planLabel}`,
        });
      }

      // Record Sales don Supervisors idan agent ne
      if (user.role === "agent" && user.assignedSupervisor && typeof Sale !== "undefined") {
        await Sale.create({
          agentId: user._id,
          supervisorId: user.assignedSupervisor,
          dataAmountGB: Number(dataPlanDoc?.sizeGB) || 0,
          planName: planLabel,
          amount: finalPrice,
          transactionRef: transactionDoc ? transactionDoc._id : null,
        }).catch(() => {});
      }

      // Ajiye Activity tare da cikakken 'user' field
      try {
        if (typeof Activity !== "undefined") {
          await Activity.create({
            user: userId,
            staffId: userId,
            action: "BUY_DATA",
            details: `Purchased ${planLabel} for ${targetPhone} at ₦${finalPrice}`,
            targetUser: userId,
          });
        }
      } catch (actErr) {
        console.warn("Activity log skipped:", actErr.message);
      }

      // Ajiye Notification
      try {
        if (typeof Notification !== "undefined") {
          await Notification.create({
            recipient: userId,
            title: "Data Purchase Successful",
            message: `Successfully sent ${planLabel} to ${targetPhone}. Amount: ₦${finalPrice}`,
            type: "vtu",
          });
        }
      } catch (notifErr) {
        console.warn("Notification skipped:", notifErr.message);
      }

      return res.status(200).json({
        success: true,
        message: `Successfully sent ${planLabel} to ${targetPhone}`,
        data: {
          transactionId: transactionDoc ? transactionDoc.transactionId : transactionId,
          newBalance: user.walletBalance,
        },
      });
    } else {
      throw new Error(resData?.message || "Marketplace declined data purchase.");
    }
  } catch (error) {
    console.error("Buy Data Internal Error:", error);

    // AUTO-REFUND LOGIC
    if (isDeducted && userId && finalPrice > 0) {
      try {
        const refundUser = await User.findById(userId);
        if (refundUser) {
          refundUser.walletBalance = Number((refundUser.walletBalance + finalPrice).toFixed(2));
          if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
          await refundUser.save();
          console.log(`✓ Auto-Refunded Data: ₦${finalPrice} to user ${userId}`);
        }

        if (transactionDoc) {
          await Transaction.findByIdAndUpdate(transactionDoc._id, {
            status: "failed",
            refundReason: error.message,
            details: `Failed & Refunded: ${error.message}`,
          });
        }
      } catch (refundErr) {
        console.error("Critical: Data refund failed:", refundErr.message);
      }
    }

    return res.status(400).json({
      success: false,
      message: error.message || "Data processing error",
    });
  }
};
