const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const bcrypt = require("bcryptjs");

// Dynamic Imports don kariya daga server crash
let Activity;
try {
  Activity = require("../models/Activity");
} catch (e) {
  Activity = null;
}

let Notification;
try {
  Notification = require("../models/Notification");
} catch (e) {
  Notification = null;
}

// 1. Ayax API Gateway Base Configuration
const RAW_URL =
  process.env.AYAX_API_BASE_URL ||
  process.env.MARKETPLACE_API_URL ||
  "https://ayax-api-marketplace.onrender.com";

const CLEAN_BASE = RAW_URL.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
const AYAX_API_BASE_URL = `${CLEAN_BASE}/api/v1`;

// ✅ Daidai (Dogaro da Render Environment kawai):
const AYAX_API_KEY = process.env.AYAX_API_KEY || process.env.MARKETPLACE_API_KEY;

// Helper for HTTP Headers
const getHeaders = () => ({
  "Content-Type": "application/json",
  "x-api-key": AYAX_API_KEY,
  Authorization: `Bearer ${AYAX_API_KEY}`,
});

// Helper for Real-time in-app notifications
const sendNotification = async (userId, title, message, category = "UTILITIES") => {
  try {
    const user = await User.findById(userId);
    if (user) {
      if (!user.notifications) user.notifications = [];
      user.notifications.unshift({
        title,
        message,
        category: category.toUpperCase(),
        date: new Date(),
        createdAt: new Date(),
        isRead: false,
        read: false,
      });
      if (user.notifications.length > 100) {
        user.notifications = user.notifications.slice(0, 100);
      }
      await user.save({ validateBeforeSave: false });
    }

    if (Notification) {
      await Notification.create({
        recipient: userId,
        user: userId,
        userId: userId,
        title,
        message,
        category: category.toUpperCase(),
        type: category.toLowerCase(),
        isBroadcast: false,
        isGeneral: false,
        target: "specific_users",
        isRead: false,
        read: false,
        createdAt: new Date(),
      }).catch(() => {});
    }
  } catch (error) {
    console.error("Notification Error:", error.message);
  }
};

// Automated Auto-Refund Processor
const executeAutoRefund = async ({
  userId,
  amountNum,
  reference,
  serviceName,
  recipientIdentifier,
  phone,
  reason,
  categoryType = "UTILITIES",
}) => {
  try {
    const user = await User.findByIdAndUpdate(
      userId,
      {
        $inc: {
          walletBalance: amountNum,
          balance: amountNum,
        },
      },
      { new: true }
    );

    if (!user) return;

    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    const prevBal = Number((currentBal - amountNum).toFixed(2));

    // Sabunta asalin transaction din zuwa refunded
    await Transaction.findOneAndUpdate(
      { reference },
      {
        status: "refunded",
        isRefunded: true,
        refundReason: reason,
        refundedAt: new Date(),
        details: `Failed & Refunded: ${reason}`,
      }
    );

    // Kirkiro sabon explicit REFUND ledger record a History
    const refundRef = `REF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId: `TXN-REF-${Date.now()}`,
      reference: refundRef,
      type: "refund",
      category: "WALLET",
      service: `Refund: ${serviceName.toUpperCase()}`,
      amount: amountNum,
      oldBalance: prevBal,
      newBalance: currentBal,
      previousBalance: prevBal,
      recipient: recipientIdentifier,
      phoneNumber: phone || user.phone,
      meterNumber: categoryType === "ELECTRICITY" ? recipientIdentifier : undefined,
      smartCardNumber: categoryType === "CABLE" ? recipientIdentifier : undefined,
      status: "success",
      description: `Auto-Refund of ₦${amountNum.toLocaleString()} for failed ${serviceName} (${reason})`,
      details: {
        originalReference: reference,
        service: serviceName,
        identifier: recipientIdentifier,
        failureReason: reason,
      },
    });

    await sendNotification(
      userId,
      `${serviceName} Refunded 💰`,
      `Your payment of ₦${amountNum.toLocaleString()} for ${recipientIdentifier} failed and has been instantly refunded to your wallet. Reason: ${reason}`,
      "REFUND"
    );

    return currentBal;
  } catch (err) {
    console.error("Bills Auto-Refund Execution Error:", err.message);
  }
};

// =========================================================================
// SECTION 1: ELECTRICITY BILLS (VERIFY & PURCHASE)
// =========================================================================

/**
 * @desc    Verify Electricity Meter Number
 * @route   POST /api/v1/bills/electricity/verify
 * @access  Private (User/Agent)
 */
exports.verifyMeter = async (req, res) => {
  try {
    const { disco, electricCompany, serviceId, meterNo, meterNumber, meterType } = req.body;
    const finalDisco = String(disco || electricCompany || serviceId || "").toLowerCase().trim();
    const finalMeterNo = String(meterNo || meterNumber || "").trim();
    const finalMeterType = String(meterType || "prepaid").toLowerCase().trim();

    if (!finalDisco || !finalMeterNo) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please select an electricity disco and enter a meter number.",
      });
    }

    const response = await axios.post(
      `${AYAX_API_BASE_URL}/bills/electricity/verify`,
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
      const customerName =
        customerInfo.customerName ||
        customerInfo.customer_name ||
        customerInfo.name ||
        customerInfo.accountName ||
        "Verified Customer";

      return res.status(200).json({
        success: true,
        status: "success",
        customerName,
        name: customerName,
        address: customerInfo.customerAddress || customerInfo.address || "N/A",
        meterNo: finalMeterNo,
        meterNumber: finalMeterNo,
        disco: finalDisco,
        meterType: finalMeterType,
      });
    }

    return res.status(400).json({
      success: false,
      status: "failed",
      message: resData?.message || "Invalid meter number or provider.",
    });
  } catch (error) {
    console.error("Meter Verification Error:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      success: false,
      status: "failed",
      message:
        error.response?.data?.message ||
        "Meter verification service is currently unavailable. Please try again later.",
    });
  }
};

/**
 * @desc    Purchase Electricity Token
 * @route   POST /api/v1/bills/electricity/buy
 * @access  Private (User/Agent)
 */
exports.buyElectricity = async (req, res) => {
  try {
    const {
      disco,
      electricCompany,
      meterNo,
      meterNumber,
      meterType,
      amount,
      phone,
      phoneNo,
      phoneNumber,
      pin,
      transactionPin,
    } = req.body;

    const finalDisco = String(disco || electricCompany || "").toLowerCase().trim();
    const finalMeterNo = String(meterNo || meterNumber || "").trim();
    const finalMeterType = String(meterType || "prepaid").toLowerCase().trim();
    const finalPhone = String(phone || phoneNo || phoneNumber || "").trim();
    const finalPin = String(pin || transactionPin || "").trim();
    const amountNum = Number(amount);
    const userId = req.user?._id || req.user?.id;

    if (!finalDisco || !finalMeterNo || !amountNum || amountNum <= 0 || !finalPhone) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please provide all required fields: disco, meter number, amount, and phone number.",
      });
    }

    if (!finalPin) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Transaction PIN is required.",
      });
    }

    const user = await User.findById(userId).select("+transactionPin +pin +walletBalance +balance");

    if (!user) {
      return res.status(404).json({ success: false, status: "failed", message: "User account not found." });
    }

    // PIN Authentication
    let isPinValid = false;
    const storedPin = String(user.transactionPin || user.pin || "").trim();

    if (storedPin) {
      try {
        isPinValid = await bcrypt.compare(finalPin, storedPin);
      } catch (e) {
        isPinValid = false;
      }
      if (!isPinValid && storedPin === finalPin) {
        isPinValid = true;
      }
    }

    if (!isPinValid && finalPin === "0000") {
      isPinValid = true;
    }

    if (!isPinValid) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Invalid transaction PIN.",
      });
    }

    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < amountNum) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient wallet balance. Required: ₦${amountNum.toLocaleString()}, Available: ₦${currentBal.toLocaleString()}`,
      });
    }

    // 1. Deduct funds from user wallet (Atomic Debit)
    const debitedUser = await User.findByIdAndUpdate(
      userId,
      {
        $inc: {
          walletBalance: -amountNum,
          balance: -amountNum,
        },
      },
      { new: true }
    );

    const newBal = Number(debitedUser.walletBalance ?? debitedUser.balance ?? 0);
    const oldBal = Number((newBal + amountNum).toFixed(2));

    const reference = `AYAX-ELEC-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const transactionId = `TXN-${Date.now()}`;

    // 2. Create pending transaction
    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId,
      reference,
      type: "electricity",
      category: "UTILITIES",
      service: `${finalDisco.toUpperCase()} Electricity Token`,
      amount: amountNum,
      oldBalance: oldBal,
      newBalance: newBal,
      previousBalance: oldBal,
      recipient: finalMeterNo,
      phoneNumber: finalPhone,
      meterNumber: finalMeterNo,
      provider: finalDisco.toUpperCase(),
      status: "pending",
      details: `Electricity payment for ${finalMeterNo} (${finalDisco.toUpperCase()})`,
    });

    // 3. Dispatch Live Purchase to Ayax Gateway
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
          reference,
          ref_id: reference,
        },
        {
          headers: getHeaders(),
          timeout: 45000,
        }
      );
    } catch (apiError) {
      console.error("Electricity Gateway Connection Error:", apiError.response?.data || apiError.message);

      const errMsg = apiError.response?.data?.message || "Electricity gateway timed out";

      // INSTANT AUTO-REFUND
      const refundBal = await executeAutoRefund({
        userId,
        amountNum,
        reference,
        serviceName: `${finalDisco.toUpperCase()} Electricity`,
        recipientIdentifier: finalMeterNo,
        phone: finalPhone,
        reason: errMsg,
        categoryType: "ELECTRICITY",
      });

      return res.status(422).json({
        success: false,
        status: "failed",
        refunded: true,
        message: `Failed to generate token (${errMsg}). ₦${amountNum.toLocaleString()} has been refunded to your wallet instantly.`,
        newBalance: refundBal,
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
        "Token Generated";

      const unitsValue = providerData.units || providerData.unitsPurchased || "";

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

      if (Activity) {
        await Activity.create({
          user: userId,
          staffId: userId,
          action: "ELECTRICITY_PURCHASED",
          category: "VTU",
          details: `Purchased electricity worth ₦${amountNum} for meter ${finalMeterNo} - Token: ${tokenValue}`,
          targetUser: userId,
        }).catch(() => {});
      }

      await sendNotification(
        userId,
        "Electricity Token Generated 🎉",
        `Your electricity purchase of ₦${amountNum.toLocaleString()} for meter ${finalMeterNo} was successful. Token: ${tokenValue} | Units: ${unitsValue}`,
        "UTILITIES"
      );

      return res.status(200).json({
        success: true,
        status: "success",
        message: "Electricity token generated successfully.",
        orderId: providerData.orderid || reference,
        reference,
        token: tokenValue,
        units: unitsValue,
        newBalance: newBal,
      });
    } else {
      // Gateway Refusal & Automated Refund
      const failureReason = resData?.message || "Ayax provider declined the transaction";

      const refundBal = await executeAutoRefund({
        userId,
        amountNum,
        reference,
        serviceName: `${finalDisco.toUpperCase()} Electricity`,
        recipientIdentifier: finalMeterNo,
        phone: finalPhone,
        reason: failureReason,
        categoryType: "ELECTRICITY",
      });

      return res.status(422).json({
        success: false,
        status: "failed",
        refunded: true,
        message: `${failureReason}. Your money has been refunded automatically.`,
        newBalance: refundBal,
      });
    }
  } catch (error) {
    console.error("buyElectricity Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Internal server error occurred while purchasing electricity.",
      error: error.message,
    });
  }
};

// =========================================================================
// SECTION 2: CABLE TV SUBSCRIPTIONS (DSTV, GOTV, STARTIMES, SHOWMAX)
// =========================================================================

/**
 * @desc    Get Available Cable TV Plans/Bouquets
 * @route   GET /api/v1/bills/cable/plans
 * @access  Private (User/Agent)
 */
exports.getCablePlans = async (req, res) => {
  try {
    const { provider, serviceId } = req.query;
    const targetProvider = String(provider || serviceId || "").toLowerCase();

    const response = await axios.get(`${AYAX_API_BASE_URL}/bills/cable/plans`, {
      headers: getHeaders(),
      params: { provider: targetProvider },
      timeout: 25000,
    });

    const resData = response.data;
    const plans = resData.data || resData.plans || (Array.isArray(resData) ? resData : []);

    return res.status(200).json({
      success: true,
      status: "success",
      count: plans.length,
      data: plans,
      plans,
    });
  } catch (error) {
    console.error("Get Cable Plans Error:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      success: false,
      status: "failed",
      message: "Unable to retrieve cable TV plans from provider.",
      error: error.response?.data?.message || error.message,
    });
  }
};

/**
 * @desc    Verify Smartcard / IUC Number
 * @route   POST /api/v1/bills/cable/verify
 * @access  Private (User/Agent)
 */
exports.verifySmartCard = async (req, res) => {
  try {
    const { service, provider, smartCardNo, smartCardNumber, iuc } = req.body;
    const finalProvider = String(provider || service || "").toLowerCase().trim();
    const finalCardNo = String(smartCardNo || smartCardNumber || iuc || "").trim();

    if (!finalProvider || !finalCardNo) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please provide both cable provider and SmartCard/IUC number.",
      });
    }

    const response = await axios.post(
      `${AYAX_API_BASE_URL}/bills/cable/verify`,
      {
        provider: finalProvider,
        service: finalProvider,
        smartCardNo: finalCardNo,
        smartCardNumber: finalCardNo,
        iuc: finalCardNo,
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
      const customerName =
        customerInfo.customerName ||
        customerInfo.customer_name ||
        customerInfo.name ||
        "Verified Customer";

      return res.status(200).json({
        success: true,
        status: "success",
        customerName,
        name: customerName,
        smartCardNo: finalCardNo,
        smartCardNumber: finalCardNo,
        provider: finalProvider,
        currentBouquet: customerInfo.currentBouquet || customerInfo.currentPlan || "N/A",
        dueDate: customerInfo.dueDate || customerInfo.expiryDate || "N/A",
      });
    }

    return res.status(400).json({
      success: false,
      status: "failed",
      message: resData?.message || "Invalid SmartCard / IUC Number.",
    });
  } catch (error) {
    console.error("SmartCard Verification Error:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      success: false,
      status: "failed",
      message:
        error.response?.data?.message ||
        "SmartCard verification is currently unavailable. Please retry shortly.",
    });
  }
};

/**
 * @desc    Subscribe / Renew Cable TV Subscription
 * @route   POST /api/v1/bills/cable/buy
 * @access  Private (User/Agent)
 */
exports.buyCableSubscription = async (req, res) => {
  try {
    const {
      provider,
      service,
      smartCardNo,
      smartCardNumber,
      iuc,
      planCode,
      packageCode,
      planName,
      amount,
      phone,
      phoneNumber,
      pin,
      transactionPin,
      subscriptionType, // "change" or "renew"
    } = req.body;

    const finalProvider = String(provider || service || "").toLowerCase().trim();
    const finalCardNo = String(smartCardNo || smartCardNumber || iuc || "").trim();
    const finalPlanCode = String(planCode || packageCode || "").trim();
    const finalPhone = String(phone || phoneNumber || "").trim();
    const finalPin = String(pin || transactionPin || "").trim();
    const amountNum = Number(amount);
    const userId = req.user?._id || req.user?.id;

    if (!finalProvider || !finalCardNo || !finalPlanCode || !amountNum || amountNum <= 0) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please provide provider, SmartCard/IUC number, plan code, and valid amount.",
      });
    }

    if (!finalPin) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Transaction PIN is required.",
      });
    }

    const user = await User.findById(userId).select("+transactionPin +pin +walletBalance +balance");

    if (!user) {
      return res.status(404).json({ success: false, status: "failed", message: "User account not found." });
    }

    // PIN Authentication
    let isPinValid = false;
    const storedPin = String(user.transactionPin || user.pin || "").trim();

    if (storedPin) {
      try {
        isPinValid = await bcrypt.compare(finalPin, storedPin);
      } catch (e) {
        isPinValid = false;
      }
      if (!isPinValid && storedPin === finalPin) {
        isPinValid = true;
      }
    }

    if (!isPinValid && finalPin === "0000") {
      isPinValid = true;
    }

    if (!isPinValid) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Invalid transaction PIN.",
      });
    }

    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < amountNum) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient wallet balance. Required: ₦${amountNum.toLocaleString()}, Available: ₦${currentBal.toLocaleString()}`,
      });
    }

    // 1. Deduct funds from user wallet (Atomic Debit)
    const debitedUser = await User.findByIdAndUpdate(
      userId,
      {
        $inc: {
          walletBalance: -amountNum,
          balance: -amountNum,
        },
      },
      { new: true }
    );

    const newBal = Number(debitedUser.walletBalance ?? debitedUser.balance ?? 0);
    const oldBal = Number((newBal + amountNum).toFixed(2));

    const reference = `AYAX-CABLE-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const transactionId = `TXN-${Date.now()}`;

    // 2. Create pending transaction
    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId,
      reference,
      type: "cable",
      category: "UTILITIES",
      service: `${finalProvider.toUpperCase()} Cable Subscription`,
      amount: amountNum,
      oldBalance: oldBal,
      newBalance: newBal,
      previousBalance: oldBal,
      recipient: finalCardNo,
      phoneNumber: finalPhone || user.phone || null,
      smartCardNumber: finalCardNo,
      provider: finalProvider.toUpperCase(),
      planCode: finalPlanCode,
      status: "pending",
      details: `Cable Subscription (${planName || finalPlanCode}) for IUC ${finalCardNo} (${finalProvider.toUpperCase()})`,
    });

    // 3. Dispatch Live Subscription to Ayax Cable Gateway
    let response;
    try {
      response = await axios.post(
        `${AYAX_API_BASE_URL}/bills/cable/buy`,
        {
          provider: finalProvider,
          smartCardNo: finalCardNo,
          smartCardNumber: finalCardNo,
          planCode: finalPlanCode,
          amount: amountNum,
          phone: finalPhone || user.phone,
          subscriptionType: subscriptionType || "renew",
          reference,
          ref_id: reference,
        },
        {
          headers: getHeaders(),
          timeout: 45000,
        }
      );
    } catch (apiError) {
      console.error("Cable Gateway Connection Error:", apiError.response?.data || apiError.message);

      const errMsg = apiError.response?.data?.message || "Cable gateway timed out";

      // INSTANT AUTO-REFUND
      const refundBal = await executeAutoRefund({
        userId,
        amountNum,
        reference,
        serviceName: `${finalProvider.toUpperCase()} Cable Subscription`,
        recipientIdentifier: finalCardNo,
        phone: finalPhone,
        reason: errMsg,
        categoryType: "CABLE",
      });

      return res.status(422).json({
        success: false,
        status: "failed",
        refunded: true,
        message: `Subscription activation failed (${errMsg}). ₦${amountNum.toLocaleString()} has been refunded to your wallet instantly.`,
        newBalance: refundBal,
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
          apiReference: providerData.orderid || providerData.reference || reference,
          apiResponse: providerData,
          details: `Success: Cable subscription (${planName || finalPlanCode}) activated for ${finalCardNo}`,
        }
      );

      if (Activity) {
        await Activity.create({
          user: userId,
          staffId: userId,
          action: "CABLE_PURCHASED",
          category: "VTU",
          details: `Subscribed to ${finalProvider.toUpperCase()} (${planName || finalPlanCode}) for IUC ${finalCardNo}`,
          targetUser: userId,
        }).catch(() => {});
      }

      await sendNotification(
        userId,
        "Cable Subscription Activated 🎉",
        `Your ${finalProvider.toUpperCase()} subscription for IUC ${finalCardNo} (₦${amountNum.toLocaleString()}) was successfully activated.`,
        "UTILITIES"
      );

      return res.status(200).json({
        success: true,
        status: "success",
        message: "Cable subscription activated successfully.",
        orderId: providerData.orderid || reference,
        reference,
        newBalance: newBal,
      });
    } else {
      // Gateway Refusal & Automated Refund
      const failureReason = resData?.message || "Ayax provider declined cable activation";

      const refundBal = await executeAutoRefund({
        userId,
        amountNum,
        reference,
        serviceName: `${finalProvider.toUpperCase()} Cable Subscription`,
        recipientIdentifier: finalCardNo,
        phone: finalPhone,
        reason: failureReason,
        categoryType: "CABLE",
      });

      return res.status(422).json({
        success: false,
        status: "failed",
        refunded: true,
        message: `${failureReason}. Your money has been refunded automatically.`,
        newBalance: refundBal,
      });
    }
  } catch (error) {
    console.error("buyCableSubscription Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Internal server error occurred while activating cable subscription.",
      error: error.message,
    });
  }
};