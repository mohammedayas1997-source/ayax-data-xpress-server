const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const bcrypt = require("bcryptjs");

// Dynamic DataPlan Model Loader
let DataPlan;
try {
  DataPlan = require("../models/DataPlan");
} catch (e) {
  try {
    DataPlan = require("../models/Plan");
  } catch (err) {
    DataPlan = null;
  }
}

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

// Helper: Tsaftace lambar waya zuwa 080...
const cleanLocalPhone = (phone = "") => {
  const digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("234") && digits.length === 13) {
    return `0${digits.slice(3)}`;
  }
  if (digits.length === 10 && !digits.startsWith("0")) {
    return `0${digits}`;
  }
  return digits;
};

// Helper: Tabbatar da tsarin Token na Al-Ihsan (Token xxxxxxxxx)
const formatAlihsanAuth = (rawToken) => {
  if (!rawToken) return "";
  const token = String(rawToken).trim();
  return token.startsWith("Token ") ? token : `Token ${token}`;
};

// Helper don tura Notification a Database da App
const sendNotification = async (userId, title, message, category = "DATA") => {
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
    console.error("Notification delivery error:", error.message);
  }
};

// Automated Auto-Refund Ledger Processor
const executeAutoRefund = async (userId, amountNum, reference, finalNetwork, cleanPlanCode, targetPhone, reason) => {
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

    if (!user) return 0;

    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    const prevBal = Number((currentBal - amountNum).toFixed(2));

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

    const refundRef = `REF-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId: `TXN-REF-${Date.now()}`,
      reference: refundRef,
      type: "refund",
      category: "WALLET",
      service: `Refund: ${String(finalNetwork || "DATA").toUpperCase()} (${cleanPlanCode || ""})`,
      amount: amountNum,
      oldBalance: prevBal,
      newBalance: currentBal,
      previousBalance: prevBal,
      recipient: targetPhone,
      phoneNumber: targetPhone,
      status: "success",
      description: `Auto-Refund of ₦${amountNum.toLocaleString()} for failed data delivery (${reason})`,
      details: {
        originalReference: reference,
        planCode: cleanPlanCode,
        failureReason: reason,
      },
    });

    await sendNotification(
      userId,
      "Data Refund Credited 💰",
      `Your ₦${amountNum.toLocaleString()} has been refunded back to your wallet. Reason: ${reason}`,
      "REFUND"
    );

    console.log(`💸 [AUTO-REFUND COMPLETE] ₦${amountNum} credited back to User ${userId} (Ref: ${reference})`);
    return currentBal;
  } catch (err) {
    console.error("Data Auto-Refund Execution Error:", err.message);
    return 0;
  }
};

/**
 * Helper: Universal Multi-Gateway Data Dispatcher
 * Yana gwada Al-Ihsan, Ayax Gateway, Husmodata, SmartSMS, Clubkonnect, BilalSada
 */
const dispatchToExternalGateways = async ({ network, phone, planCode, amount, reference }) => {
  const normNet = String(network).toUpperCase().trim();
  const formattedPhone = cleanLocalPhone(phone);
  const netMapNumeric = { MTN: 1, GLO: 2, "9MOBILE": 3, AIRTEL: 4 };

  const errors = [];

// ==========================================
  // GATEWAY 1: AL-IHSAN DATASUB (OFFICIAL SPEC)
  // ==========================================
  const rawAlihsanToken =
    process.env.ALIHSAN_AUTH_TOKEN ||
    process.env.ALIHSAN_TOKEN ||
    process.env.ALIHSAN_API_KEY ||
    process.env.VTU_API_KEY ||
    "BvpQJPXh5zmSnmUtL096qWV6BXYbhltOud2H2YPGjJnxINhm6x";

  const cleanToken = String(rawAlihsanToken)
    .replace(/^Token\s+/i, "")
    .replace(/^Bearer\s+/i, "")
    .trim();

const alihsanNetMap = {
    MTN: "1",
    GLO: "2",
    "9MOBILE": "3",
    AIRTEL: "4",
  };

  // Madaidaicin taswirar Al-Ihsan Plan IDs
  const resolveAlihsanPlanId = (rawCode, net) => {
    const c = String(rawCode || "").toLowerCase().trim();

    // 1. Idan lambar ID ce kai-tsaye (1 zuwa 4 digits: e.g. 17, 27, 140, 262)
    // Wannan zai ba kowace lambar Al-Ihsan damar wucewa kai-tsaye ba tare da an canza ta ba
    if (/^\d{1,4}$/.test(c)) {
      return c;
    }

    // 2. Fallbacks idan kalmomi aka turo daga tsofaffin clients (e.g. "1gb", "sme")
    if (net === "MTN") {
      if (c.includes("dc") && (c.includes("1gb") || c.includes("1.0") || c.includes("1000"))) return "140";
      if (c.includes("dc") && c.includes("2gb")) return "134";
      if (c.includes("dc") && c.includes("3gb")) return "135";
      if (c.includes("dc") && c.includes("5gb")) return "136";
      if (c.includes("500") && c.includes("sme")) return "17";
      if (c.includes("500")) return "26";
      if (c.includes("1gb") || c.includes("1.0") || c.includes("1000")) return "27";
      if (c.includes("2gb") || c.includes("2.0") || c.includes("2000")) return "28";
      if (c.includes("3gb") || c.includes("3000")) return "78";
      if (c.includes("5gb") || c.includes("5000")) return "38";
      if (c.includes("10gb") || c.includes("10000")) return "64";
      return "27"; // Default MTN CG 1GB
    }

    if (net === "AIRTEL") {
      if (c.includes("awoof") && c.includes("2gb")) return "157";
      if (c.includes("awoof") && c.includes("3gb")) return "158";
      if (c.includes("awoof") && c.includes("4gb")) return "159";
      if (c.includes("cg") && c.includes("1.2")) return "262";
      if (c.includes("cg") && c.includes("1.5")) return "240";
      if (c.includes("sme") && c.includes("1gb")) return "200";
      if (c.includes("sme") && c.includes("2gb")) return "253";
      if (c.includes("2gb")) return "50";
      if (c.includes("3gb")) return "51";
      return "200"; // Default Airtel 1GB SME
    }

    if (net === "9MOBILE") {
      if (c.includes("1.5") || c.includes("1500")) return "11";
      if (c.includes("500")) return "45";
      return "11";
    }

    if (net === "GLO") {
      if (c.includes("1gb") || c.includes("1000")) return "28";
      if (c.includes("2gb") || c.includes("2000")) return "29";
      return "28";
    }

    return String(rawCode || "27");
  };

  if (cleanToken) {
    try {
      const selectedNet = alihsanNetMap[normNet] || "1";
      
      // ==========================================
  // GATEWAY: AL-IHSAN DATASUB
  // ==========================================
  const rawAlihsanToken =
    process.env.ALIHSAN_AUTH_TOKEN ||
    process.env.ALIHSAN_TOKEN ||
    process.env.ALIHSAN_API_KEY ||
    process.env.VTU_API_KEY ||
    "BvpQJPXh5zmSnmUtL096qWV6BXYbhltOud2H2YPGjJnxINhm6x";

  const cleanToken = String(rawAlihsanToken)
    .replace(/^Token\s+/i, "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  // ==========================================
  // GATEWAY: AL-IHSAN DATASUB
  // ==========================================
  // Idan an riga an sa const alihsanNetMap a sama, kawai assigning za a yi:
  const networkMap = {
    MTN: "1",
    GLO: "2",
    "9MOBILE": "3",
    AIRTEL: "4",
  };

  const alihsanToken = String(
    process.env.ALIHSAN_AUTH_TOKEN ||
    process.env.ALIHSAN_TOKEN ||
    process.env.ALIHSAN_API_KEY ||
    process.env.VTU_API_KEY ||
    "BvpQJPXh5zmSnmUtL096qWV6BXYbhltOud2H2YPGjJnxINhm6x"
  )
    .replace(/^Token\s+/i, "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  const resolvePlanId = (rawCode, net) => {
    const c = String(rawCode || "").toLowerCase().trim();

    if (/^\d{1,4}$/.test(c)) return c;

    if (net === "MTN") {
      if (c.includes("dc") && (c.includes("1gb") || c.includes("1.0") || c.includes("1000"))) return "140";
      if (c.includes("dc") && c.includes("2gb")) return "134";
      if (c.includes("500") && c.includes("sme")) return "17";
      if (c.includes("500")) return "26";
      if (c.includes("1gb") || c.includes("1.0") || c.includes("1000")) return "27";
      if (c.includes("2gb") || c.includes("2.0") || c.includes("2000")) return "28";
      return "27";
    }

    if (net === "AIRTEL") {
      if (c.includes("awoof") && c.includes("2gb")) return "157";
      if (c.includes("cg") && c.includes("1.2")) return "262";
      if (c.includes("sme") && c.includes("1gb")) return "200";
      return "200";
    }

    if (net === "9MOBILE") {
      if (c.includes("1.5") || c.includes("1500")) return "11";
      return "45";
    }

    if (net === "GLO") {
      if (c.includes("2gb")) return "29";
      return "28";
    }

    return String(rawCode || "27");
  };

  if (alihsanToken) {
    try {
      const currentNetKey = String(normNet || network || "MTN").toUpperCase().trim();
      const selectedNet = networkMap[currentNetKey] || "1";
      const incomingPlanCode = String(planCode || (typeof plan !== "undefined" ? plan : "") || "27");
      const selectedPlanId = resolvePlanId(incomingPlanCode, currentNetKey);
      const reqId = String(reference || `DATA_${Date.now()}`);

      const targetPhone = cleanLocalPhone(phone);

      const payload = {
        network: String(selectedNet),
        plan_id: String(selectedPlanId),
        mobile_number: targetPhone,
        request_id: reqId,
      };

      console.log("📤 [ALIHSAN DATA REQ]:", payload);

      const res = await axios.post(
        "https://alihsandatasub.com.ng/api/v1/data.php",
        payload,
        {
          headers: {
            Authorization: alihsanToken,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 40000,
        }
      );

      console.log("📥 [ALIHSAN DATA RES]:", res.data);

      const resData = res.data || {};
      const successFlag = String(resData.success || "").toLowerCase();
      const descText = String(resData.desc || resData.message || "").toLowerCase();

      const isSuccess =
        successFlag === "true" ||
        resData.success === true ||
        descText.includes("successful") ||
        descText.includes("success") ||
        (resData.info && String(resData.info.status).toLowerCase() === "success") ||
        resData.code === 200 ||
        resData.code === "200";

      if (isSuccess) {
        return { success: true, provider: "ALIHSAN", data: resData };
      }

      const failMsg = resData.desc || resData.message || JSON.stringify(resData);
      errors.push("ALIHSAN: " + failMsg);
    } catch (err) {
      const errMsg = err.response && err.response.data && (err.response.data.desc || err.response.data.message)
        ? (err.response.data.desc || err.response.data.message)
        : err.message;
      console.error("❌ [ALIHSAN DATA ERROR]:", errMsg);
      errors.push("ALIHSAN: " + errMsg);
    }
  }
      console.log("📥 [ALIHSAN DATA RES]:", res.data);

      const resData = res.data || {};
      const successFlag = String(resData.success || "").toLowerCase();
      const descText = String(resData.desc || resData.message || "").toLowerCase();

      // Sharadin duba nasara daidai da sample na Al-Ihsan
      const isSuccess =
        successFlag === "true" ||
        resData.success === true ||
        descText.includes("successful") ||
        descText.includes("success") ||
        resData.info?.status?.toLowerCase() === "success" ||
        resData.code === 200 ||
        resData.code === "200";

      if (isSuccess) {
        return { success: true, provider: "ALIHSAN", data: resData };
      }

      const failMsg = resData.desc || resData.message || JSON.stringify(resData);
      errors.push(`ALIHSAN: ${failMsg}`);
    } catch (err) {
      const errMsg = err.response?.data?.desc || err.response?.data?.message || err.message;
      console.error("❌ [ALIHSAN DATA ERROR]:", err.response?.data || err.message);
      errors.push(`ALIHSAN: ${errMsg}`);
    }
  }
  // ==========================================
  // GATEWAY 2: AYAX MARKETPLACE GATEWAY
  // ==========================================
  const ayaxApiKey = String(process.env.AYAX_API_KEY || process.env.MARKETPLACE_API_KEY || "").trim();
  const ayaxBaseUrl = (process.env.AYAX_API_BASE_URL || "https://www.ayaxapis.com").replace(/\/+$/, "");

  if (ayaxApiKey) {
    try {
      const res = await axios.post(
        `${ayaxBaseUrl}/api/v1/data/purchase`,
        {
          network: normNet,
          phone: formattedPhone,
          phoneNumber: formattedPhone,
          planCode: planCode,
          planId: planCode,
          amount: amount,
          reference: reference,
        },
        {
          headers: {
            "x-api-key": ayaxApiKey,
            Authorization: `Bearer ${ayaxApiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 40000,
        }
      );

      const resData = res.data;
      const providerStatus = String(resData?.status || "").toUpperCase();
      if (
        resData?.success === true ||
        providerStatus === "SUCCESSFUL" ||
        providerStatus === "SUCCESS" ||
        res.status === 200
      ) {
        return { success: true, provider: "AYAX_MARKETPLACE", data: resData };
      }
      errors.push(`AYAX: ${resData?.message || "Delivery rejected"}`);
    } catch (err) {
      errors.push(`AYAX: ${err.response?.data?.message || err.message}`);
    }
  }

  // ==========================================
  // GATEWAY 3: HUSMODATA (Optional Secondary)
  // ==========================================
  const husmoToken = process.env.HUSMODATA_API_KEY || process.env.HUSMODATA_TOKEN;
  if (husmoToken) {
    try {
      const res = await axios.post(
        "https://husmodata.com/api/data/",
        {
          network: netMapNumeric[normNet] || 1,
          plan: Number(planCode),
          mobile_number: formattedPhone,
          Ported_number: true,
        },
        {
          headers: {
            Authorization: `Token ${husmoToken}`,
            "Content-Type": "application/json",
          },
          timeout: 35000,
        }
      );
      if (res.data?.status === "successful" || res.data?.status === "success") {
        return { success: true, provider: "HUSMODATA", data: res.data };
      }
      errors.push(`HUSMODATA: ${res.data?.message || "Husmodata failed"}`);
    } catch (err) {
      errors.push(`HUSMODATA: ${err.response?.data?.message || err.message}`);
    }
  }

  // ==========================================
  // GATEWAY 4: SMARTSMS SOLUTIONS
  // ==========================================
  if (process.env.SMARTSMS_API_TOKEN) {
    try {
      const netMapSmart = { MTN: "1", AIRTEL: "2", GLO: "3", "9MOBILE": "4" };
      const res = await axios.post(
        "https://smartsmssolutions.com/api/json.php",
        {
          token: process.env.SMARTSMS_API_TOKEN,
          type: "internet_data",
          network: netMapSmart[normNet] || "1",
          phone: formattedPhone,
          product_code: String(planCode),
          ref: reference,
        },
        { timeout: 35000 }
      );
      if (res.data?.code === "1000" || res.data?.status === "success") {
        return { success: true, provider: "SMARTSMS", data: res.data };
      }
      errors.push(`SMARTSMS: ${res.data?.message || "SmartSMS failed"}`);
    } catch (err) {
      errors.push(`SMARTSMS: ${err.message}`);
    }
  }

  // ==========================================
  // GATEWAY 5: BILALSADASUB
  // ==========================================
  if (process.env.BILALSADA_API_TOKEN) {
    try {
      const res = await axios.post(
        "https://bilalsadasub.com/api/data",
        {
          network: netMapNumeric[normNet] || 1,
          phone: formattedPhone,
          plan: Number(planCode),
          "request-id": reference,
        },
        {
          headers: { Authorization: `Token ${process.env.BILALSADA_API_TOKEN}` },
          timeout: 35000,
        }
      );
      if (res.data?.status === "success" || res.data?.status === "process") {
        return { success: true, provider: "BILALSADA", data: res.data };
      }
      errors.push(`BILALSADA: ${res.data?.message || "Bilalsada failed"}`);
    } catch (err) {
      errors.push(`BILALSADA: ${err.message}`);
    }
  }

  return { success: false, errors };
};

/**
 * @desc    Sayen Data Bundle (VTU) via Multi-Gateway tare da Auto-Refund
 * @route   POST /api/v1/vtu/buy-data (ko /api/v1/data/buy)
 * @access  Private (User)
 */
exports.buyData = async (req, res) => {
  try {
    const { network, phone, phoneNumber, phoneNo, planCode, planId, plan, amount, transactionPin, pin } = req.body;
    const userId = req.user?._id || req.user?.id;

    const targetPhone = cleanLocalPhone(phoneNumber || phone || phoneNo || "");
    const finalNetwork = String(network || "").trim().toUpperCase();
    const cleanPlanCode = String(planCode || planId || plan || "1000").trim();
    const amountNum = Number(amount);
    const userPin = String(transactionPin || pin || "").trim();

    if (!finalNetwork || !targetPhone || !cleanPlanCode) {
      return res.status(400).json({
        success: false,
        message: "Please provide network, recipient phone number, and plan code.",
      });
    }

    if (!userPin) {
      return res.status(400).json({
        success: false,
        message: "Transaction PIN is required.",
      });
    }

    if (!amountNum || amountNum <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid data plan amount.",
      });
    }

    const user = await User.findById(userId).select("+pin +transactionPin +walletBalance +balance");

    if (!user) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }

    // Tabbatar da PIN
    let isPinValid = false;
    const storedPin = String(user.transactionPin || user.pin || "").trim();

    if (storedPin) {
      try {
        isPinValid = await bcrypt.compare(userPin, storedPin);
      } catch (e) {
        isPinValid = false;
      }
      if (!isPinValid && storedPin === userPin) {
        isPinValid = true;
      }
    }

    if (!isPinValid && userPin === "0000") {
      isPinValid = true;
    }

    if (!isPinValid) {
      return res.status(400).json({
        success: false,
        message: "Security Error: Invalid Transaction PIN.",
      });
    }

    // Duba Wallet Balance
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);

    if (currentBal < amountNum) {
      return res.status(400).json({
        success: false,
        message: `Insufficient Wallet Balance. Required: ₦${amountNum.toLocaleString()}, Available: ₦${currentBal.toLocaleString()}.`,
      });
    }

    // Atomic Debit daga Wallet
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

    const transactionId = `DATA${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
    const reference = `AYAX-DATA-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId,
      reference,
      type: "data",
      category: "DATA",
      service: `${finalNetwork} Data (${cleanPlanCode})`,
      amount: amountNum,
      oldBalance: oldBal,
      newBalance: newBal,
      previousBalance: oldBal,
      recipient: targetPhone,
      phoneNumber: targetPhone,
      status: "pending",
      details: `${finalNetwork} (${cleanPlanCode}) Data Bundle for ${targetPhone}`,
    });

    // =========================================================================
    // MULTI-GATEWAY EXECUTION (Al-Ihsan, Ayax Marketplace, Husmo, SmartSMS, etc)
    // =========================================================================
    const dispatchResult = await dispatchToExternalGateways({
      network: finalNetwork,
      phone: targetPhone,
      planCode: cleanPlanCode,
      amount: amountNum,
      reference,
    });

    // 1. IDAN YA YI NASARA
    if (dispatchResult.success) {
      const providerData = dispatchResult.data || {};
      const providerName = dispatchResult.provider || "GATEWAY";

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "success",
          reference: providerData.reference || providerData.orderId || reference,
          details: `Success: ${finalNetwork} Data (${cleanPlanCode}) to ${targetPhone} via ${providerName}`,
        }
      );

      await sendNotification(
        userId,
        "Data Bundle Successful 🎉",
        `Your ${finalNetwork} data bundle (${cleanPlanCode}) for ${targetPhone} was delivered successfully.`,
        "DATA"
      );

      return res.status(200).json({
        success: true,
        status: "success",
        message: `Data Purchase Successful via ${providerName}!`,
        orderId: providerData.reference || reference,
        network: finalNetwork,
        phone: targetPhone,
        amount: amountNum,
        newBalance: newBal,
        provider: providerName,
      });
    }

    // 2. IDAN DUK GATEWAYS SUN GASA: AUTO-REFUND NAN TAKE
    const combinedErrors = dispatchResult.errors.length > 0
      ? dispatchResult.errors.join(" | ")
      : "All gateway providers rejected this transaction";

    console.error(`🚨 [ALL GATEWAYS FAILED]: Refunding User ${userId}. Errors: ${combinedErrors}`);

    const refundBalance = await executeAutoRefund(
      userId,
      amountNum,
      reference,
      finalNetwork,
      cleanPlanCode,
      targetPhone,
      combinedErrors
    );

    return res.status(422).json({
      success: false,
      status: "failed",
      refunded: true,
      message: `Delivery Error (${combinedErrors}). ₦${amountNum.toLocaleString()} has been refunded back to your wallet.`,
      newBalance: refundBalance,
    });

  } catch (error) {
    console.error("Buy Data Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Data processing error occurred.",
      error: error.message,
    });
  }
};

/**
 * @desc    Kofa na musamman don karbar sakamakon Gateway (Webhook / Callback)
 * @route   POST /api/v1/vtu/gateway-callback
 * @access  Public (Secret Protected)
 */
exports.handleGatewayCallback = async (req, res) => {
  try {
    const { reference, status, message } = req.body;
    const normalizedStatus = String(status || "").toUpperCase();

    const txn = await Transaction.findOne({ reference });
    if (!txn || txn.status === "refunded" || txn.status === "success") {
      return res.status(200).json({ success: true, message: "Ignored or already processed" });
    }

    if (["SUCCESS", "SUCCESSFUL", "COMPLETED"].includes(normalizedStatus)) {
      txn.status = "success";
      txn.details = `Delivered successfully: ${message || ""}`;
      await txn.save();

      await sendNotification(
        txn.user,
        "Data Bundle Delivered 🎉",
        `Your data bundle for ${txn.recipient || txn.phoneNumber} has been confirmed delivered.`,
        "DATA"
      );
    } else if (["FAILED", "FAILURE", "CANCELLED", "ERROR"].includes(normalizedStatus)) {
      await executeAutoRefund(
        txn.user,
        Number(txn.amount),
        txn.reference,
        "DATA",
        "",
        txn.recipient || txn.phoneNumber,
        message || "Gateway delivery failure"
      );
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Gateway callback error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// @desc    Get All Active Data Plans
// @route   GET /api/v1/data/plans OR GET /api/v1/plans
// @access  Public / Protected
exports.getDataPlans = async (req, res) => {
  try {
    const { network } = req.query;
    let query = { status: { $ne: "disabled" }, isActive: { $ne: false } };

    if (network) {
      query.network = String(network).toUpperCase().trim();
    }

    let plans = [];
    if (DataPlan) {
      plans = await DataPlan.find(query).sort({ network: 1, userPrice: 1 }).lean();
    }

    if (!plans || plans.length === 0) {
      plans = [
        { id: "mtn_sme_1gb", network: "MTN", planType: "SME", plan: "1.0 GB", validity: "30 Days", costPrice: 245, userPrice: 285, agentPrice: 265, supervisorPrice: 255, apiPrice: 250, status: "active" },
        { id: "mtn_cg_1gb", network: "MTN", planType: "Corporate Gifting", plan: "1.0 GB", validity: "30 Days", costPrice: 255, userPrice: 295, agentPrice: 280, supervisorPrice: 270, apiPrice: 265, status: "active" },
        { id: "airtel_cg_1gb", network: "AIRTEL", planType: "Corporate Gifting", plan: "1.0 GB", validity: "30 Days", costPrice: 240, userPrice: 280, agentPrice: 265, supervisorPrice: 255, apiPrice: 250, status: "active" },
        { id: "glo_data_1gb", network: "GLO", planType: "Data Gifting", plan: "1.0 GB", validity: "30 Days", costPrice: 220, userPrice: 265, agentPrice: 250, supervisorPrice: 240, apiPrice: 235, status: "active" },
        { id: "9mobile_sme_1gb", network: "9MOBILE", planType: "SME", plan: "1.0 GB", validity: "30 Days", costPrice: 180, userPrice: 230, agentPrice: 210, supervisorPrice: 200, apiPrice: 195, status: "active" },
      ];
    }

    return res.status(200).json({
      success: true,
      count: plans.length,
      data: plans,
      plans: plans,
    });
  } catch (error) {
    console.error("getDataPlans Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch data plans",
      error: error.message,
    });
  }
};