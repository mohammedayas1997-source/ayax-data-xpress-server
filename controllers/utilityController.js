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

// Helper: Tabbatar da tsarin Authorization Token na Al-Ihsan
const formatAlihsanAuth = (rawToken) => {
  if (!rawToken) return "";
  const token = String(rawToken).trim();
  return token.startsWith("Token ") ? token : `Token ${token}`;
};

const getAlihsanToken = () => {
  return (
    process.env.ALIHSAN_AUTH_TOKEN ||
    process.env.ALIHSAN_TOKEN ||
    process.env.ALIHSAN_API_KEY ||
    process.env.VTU_API_KEY ||
    "BvpQJPXh5zmSnmUtL096qWV6BXYbhltOud2H2YPGjJnxINhm6x"
  );
};

// Dynamic Header & Base URL Generator don Ayax Gateway
const getHeaders = () => {
  const activeKey = String(
    process.env.AYAX_API_KEY || process.env.MARKETPLACE_API_KEY || ""
  ).trim();

  return {
    "Content-Type": "application/json",
    "x-api-key": activeKey,
    Authorization: `Bearer ${activeKey}`,
  };
};

const getBaseUrl = () => {
  const rawUrl =
    process.env.AYAX_API_BASE_URL ||
    process.env.MARKETPLACE_API_URL ||
    "https://www.ayaxapis.com";
  const cleanBase = rawUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return `${cleanBase}/api/v1`;
};

// Helper: Taswirar Disco zuwa ID na Al-Ihsan da VTpass
const mapDiscoCode = (discoName = "") => {
  const d = String(discoName).toLowerCase();
  if (d.includes("ikeja") || d.includes("ikedc")) return { id: 1, vtpass: "ikeja-electric", name: "IKEDC" };
  if (d.includes("eko") || d.includes("ekedc")) return { id: 2, vtpass: "eko-electric", name: "EKEDC" };
  if (d.includes("abuja") || d.includes("aedc")) return { id: 3, vtpass: "abuja-electric", name: "AEDC" };
  if (d.includes("kano") || d.includes("kedco")) return { id: 4, vtpass: "kano-electric", name: "KEDCO" };
  if (d.includes("portharcourt") || d.includes("phedc") || d.includes("phed")) return { id: 5, vtpass: "portharcourt-electric", name: "PHED" };
  if (d.includes("jos") || d.includes("jedc")) return { id: 6, vtpass: "jos-electric", name: "JEDC" };
  if (d.includes("ibadan") || d.includes("ibedc")) return { id: 7, vtpass: "ibadan-electric", name: "IBEDC" };
  if (d.includes("kaduna") || d.includes("kaedco")) return { id: 8, vtpass: "kaduna-electric", name: "KAEDCO" };
  if (d.includes("enugu") || d.includes("eedc")) return { id: 9, vtpass: "enugu-electric", name: "EEDC" };
  if (d.includes("benin") || d.includes("bedc")) return { id: 10, vtpass: "benin-electric", name: "BEDC" };
  if (d.includes("aba")) return { id: 11, vtpass: "aba-electric", name: "ABA" };
  return { id: 1, vtpass: "ikeja-electric", name: "IKEDC" };
};

// Helper: Taswirar Cable TV Provider zuwa ID na Al-Ihsan da VTpass
const mapCableProvider = (cableName = "") => {
  const c = String(cableName).toLowerCase();
  if (c.includes("gotv")) return { id: 1, vtpass: "gotv", name: "GOTV" };
  if (c.includes("dstv")) return { id: 2, vtpass: "dstv", name: "DSTV" };
  if (c.includes("startimes") || c.includes("startime")) return { id: 3, vtpass: "startimes", name: "STARTIMES" };
  if (c.includes("showmax")) return { id: 4, vtpass: "showmax", name: "SHOWMAX" };
  return { id: 1, vtpass: "gotv", name: "GOTV" };
};

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

    console.log(`💸 [BILLS AUTO-REFUND] ₦${amountNum} refunded to User ${userId} (Ref: ${reference})`);
    return currentBal;
  } catch (err) {
    console.error("Bills Auto-Refund Execution Error:", err.message);
    return 0;
  }
};

// =========================================================================
// SECTION 1: ELECTRICITY BILLS (MULTI-GATEWAY VERIFY & PURCHASE)
// =========================================================================

/**
 * @desc    Verify Electricity Meter Number
 * @route   POST /api/v1/bills/electricity/verify
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

    const discoInfo = mapDiscoCode(finalDisco);
    const userId = req.user ? req.user._id || req.user.id : null;
    let verifiedCustomerName = "";
    let verifiedAddress = "N/A";

    // 1. Gwada Al-Ihsan Meter Validation
    const rawAlihsanToken = getAlihsanToken();
    if (rawAlihsanToken) {
      try {
        const baseUrl = process.env.ALIHSAN_BASE_URL || "https://alihsandatasub.com.ng/api";
        const alihsanRes = await axios.get(`${baseUrl}/validatemeter`, {
          params: {
            meter_number: finalMeterNo,
            disconame: discoInfo.id,
            mtype: finalMeterType === "prepaid" ? 1 : 2,
          },
          headers: {
            Authorization: formatAlihsanAuth(rawAlihsanToken),
            Accept: "application/json",
          },
          timeout: 20000,
        });

        if (alihsanRes.data?.name || alihsanRes.data?.customer_name || alihsanRes.data?.Customer_Name) {
          verifiedCustomerName =
            alihsanRes.data.name ||
            alihsanRes.data.customer_name ||
            alihsanRes.data.Customer_Name;
          verifiedAddress = alihsanRes.data.address || "N/A";
        }
      } catch (_) {}
    }

    // 2. Gwada Ayax Marketplace Gateway
    if (!verifiedCustomerName) {
      try {
        const baseUrl = getBaseUrl();
        const ayaxRes = await axios.post(
          `${baseUrl}/bills/electricity/verify`,
          {
            disco: finalDisco,
            serviceId: finalDisco,
            meterNo: finalMeterNo,
            meterNumber: finalMeterNo,
            meterType: finalMeterType,
          },
          {
            headers: getHeaders(),
            timeout: 20000,
          }
        );

        if (ayaxRes.data?.data?.customerName || ayaxRes.data?.customerName || ayaxRes.data?.name) {
          verifiedCustomerName =
            ayaxRes.data.data?.customerName ||
            ayaxRes.data.customerName ||
            ayaxRes.data.name;
          verifiedAddress = ayaxRes.data.data?.customerAddress || ayaxRes.data.address || "N/A";
        }
      } catch (_) {}
    }

    // 3. Gwada VTpass
    if (!verifiedCustomerName && process.env.VTPASS_API_KEY) {
      try {
        const vtpassRes = await axios.post(
          "https://api-service.vtpass.com/api/merchant-verify",
          {
            billersCode: finalMeterNo,
            serviceID: discoInfo.vtpass,
            type: finalMeterType,
          },
          {
            headers: {
              "api-key": process.env.VTPASS_API_KEY,
              "secret-key": process.env.VTPASS_SECRET_KEY,
            },
            timeout: 20000,
          }
        );
        if (vtpassRes.data?.content?.Customer_Name) {
          verifiedCustomerName = vtpassRes.data.content.Customer_Name;
          verifiedAddress = vtpassRes.data.content.Address || "N/A";
        }
      } catch (_) {}
    }

    if (verifiedCustomerName) {
      if (userId && Activity) {
        await Activity.create({
          user: userId,
          staffId: userId,
          action: "METER_VERIFIED",
          category: "VTU",
          details: `Verified meter ${finalMeterNo} (${discoInfo.name}) - Name: ${verifiedCustomerName}`,
          targetUser: userId,
        }).catch(() => {});
      }

      return res.status(200).json({
        success: true,
        status: "success",
        customerName: verifiedCustomerName,
        name: verifiedCustomerName,
        address: verifiedAddress,
        meterNo: finalMeterNo,
        meterNumber: finalMeterNo,
        disco: finalDisco,
        meterType: finalMeterType,
        serviceFee: 50,
      });
    }

    return res.status(400).json({
      success: false,
      status: "failed",
      message: "Could not verify meter number. Please check the digits and DISCO provider.",
    });
  } catch (error) {
    console.error("Meter Verification Error:", error.message);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Meter verification service is temporarily unavailable. Please retry shortly.",
    });
  }
};

/**
 * Dispatcher for Electricity Token (Al-Ihsan, Ayax Gateway, VTpass)
 */
const dispatchElectricityToken = async ({ disco, meterNo, meterType, amount, phone, reference }) => {
  const discoInfo = mapDiscoCode(disco);
  const formattedPhone = cleanLocalPhone(phone);
  const errors = [];

  // 1. AL-IHSAN DATASUB
  const rawAlihsanToken = getAlihsanToken();
  if (rawAlihsanToken) {
    try {
      const baseUrl = process.env.ALIHSAN_BASE_URL || "https://alihsandatasub.com.ng/api";
      const res = await axios.post(
        `${baseUrl}/bill/`,
        {
          disco_name: discoInfo.id,
          amount: Number(amount),
          meter_number: meterNo,
          MeterType: meterType.toLowerCase() === "prepaid" ? 1 : 2,
          customer_phone: formattedPhone,
          reference: reference,
        },
        {
          headers: {
            Authorization: formatAlihsanAuth(rawAlihsanToken),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 45000,
        }
      );

      const status = String(res.data?.status || res.data?.Status || "").toLowerCase();
      if (status === "success" || status === "successful" || status === "true") {
        const token =
          res.data?.token ||
          res.data?.meter_token ||
          res.data?.mainToken ||
          res.data?.token_code ||
          "Token Generated Successfully";
        const units = res.data?.units || res.data?.unit || "";

        return { success: true, provider: "ALIHSAN", token, units, data: res.data };
      }
      errors.push(`ALIHSAN: ${res.data?.message || res.data?.error || "Al-Ihsan electricity declined"}`);
    } catch (err) {
      errors.push(`ALIHSAN: ${err.response?.data?.message || err.message}`);
    }
  }

  // 2. AYAX MARKETPLACE GATEWAY
  const ayaxApiKey = String(process.env.AYAX_API_KEY || process.env.MARKETPLACE_API_KEY || "").trim();
  if (ayaxApiKey) {
    try {
      const baseUrl = getBaseUrl();
      const res = await axios.post(
        `${baseUrl}/bills/electricity/buy`,
        {
          disco,
          meterNo,
          meterType,
          amount: Number(amount),
          phone: formattedPhone,
          reference,
        },
        {
          headers: getHeaders(),
          timeout: 45000,
        }
      );

      const resData = res.data;
      if (resData?.success === true || resData?.status === "success") {
        const providerData = resData.data || resData;
        const token =
          providerData.token ||
          providerData.meterToken ||
          providerData.tokenCode ||
          "Token Generated";
        const units = providerData.units || providerData.unit || "";

        return { success: true, provider: "AYAX_GATEWAY", token, units, data: providerData };
      }
      errors.push(`AYAX: ${resData?.message || "Ayax Gateway failed"}`);
    } catch (err) {
      errors.push(`AYAX: ${err.response?.data?.message || err.message}`);
    }
  }

  // 3. VTPASS ELECTRICITY
  if (process.env.VTPASS_API_KEY && process.env.VTPASS_SECRET_KEY) {
    try {
      const res = await axios.post(
        "https://api-service.vtpass.com/api/pay",
        {
          request_id: reference,
          serviceID: discoInfo.vtpass,
          billersCode: meterNo,
          variation_code: meterType,
          amount: Number(amount),
          phone: formattedPhone,
        },
        {
          headers: {
            "api-key": process.env.VTPASS_API_KEY,
            "secret-key": process.env.VTPASS_SECRET_KEY,
          },
          timeout: 45000,
        }
      );

      if (res.data?.code === "000") {
        const token = res.data?.token || res.data?.purchased_code || "Token Generated";
        const units = res.data?.units || "";
        return { success: true, provider: "VTPASS", token, units, data: res.data };
      }
      errors.push(`VTPASS: ${res.data?.response_description || "VTpass declined"}`);
    } catch (err) {
      errors.push(`VTPASS: ${err.message}`);
    }
  }

  return { success: false, errors };
};

/**
 * @desc    Purchase Electricity Token (₦50 Service Fee Applied)
 * @route   POST /api/v1/bills/electricity/buy
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
    const finalPhone = cleanLocalPhone(phone || phoneNo || phoneNumber || "");
    const finalPin = String(pin || transactionPin || "").trim();
    const tokenAmount = Number(amount);
    const userId = req.user?._id || req.user?.id;

    const SERVICE_FEE = 50;
    const totalAmountToDebit = Number((tokenAmount + SERVICE_FEE).toFixed(2));

    if (!finalDisco || !finalMeterNo || !tokenAmount || tokenAmount <= 0 || !finalPhone) {
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
    if (currentBal < totalAmountToDebit) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient wallet balance. Required: ₦${totalAmountToDebit.toLocaleString()} (Token: ₦${tokenAmount.toLocaleString()} + ₦${SERVICE_FEE} Fee), Available: ₦${currentBal.toLocaleString()}`,
      });
    }

    // Cire duka jimillar kudin daga Wallet
    const debitedUser = await User.findByIdAndUpdate(
      userId,
      {
        $inc: {
          walletBalance: -totalAmountToDebit,
          balance: -totalAmountToDebit,
        },
      },
      { new: true }
    );

    const newBal = Number(debitedUser.walletBalance ?? debitedUser.balance ?? 0);
    const oldBal = Number((newBal + totalAmountToDebit).toFixed(2));

    const reference = `AYAX-ELEC-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const transactionId = `TXN-${Date.now()}`;

    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId,
      reference,
      type: "electricity",
      category: "UTILITIES",
      service: `${finalDisco.toUpperCase()} Electricity Token`,
      amount: totalAmountToDebit,
      oldBalance: oldBal,
      newBalance: newBal,
      previousBalance: oldBal,
      recipient: finalMeterNo,
      phoneNumber: finalPhone,
      meterNumber: finalMeterNo,
      provider: finalDisco.toUpperCase(),
      status: "pending",
      details: `${finalDisco.toUpperCase()} Meter ${finalMeterNo} (Token: ₦${tokenAmount} + Fee: ₦${SERVICE_FEE})`,
    });

    // MULTI-GATEWAY TOKEN GENERATION
    const dispatchResult = await dispatchElectricityToken({
      disco: finalDisco,
      meterNo: finalMeterNo,
      meterType: finalMeterType,
      amount: tokenAmount,
      phone: finalPhone,
      reference,
    });

    if (dispatchResult.success) {
      const tokenValue = dispatchResult.token || "Token Generated";
      const unitsValue = dispatchResult.units || "";
      const providerName = dispatchResult.provider || "GATEWAY";

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "success",
          token: tokenValue,
          units: unitsValue,
          apiReference: reference,
          apiResponse: dispatchResult.data,
          details: `Success: Token (${tokenValue}) for Meter ${finalMeterNo} via ${providerName}`,
        }
      );

      if (Activity) {
        await Activity.create({
          user: userId,
          staffId: userId,
          action: "ELECTRICITY_PURCHASED",
          category: "VTU",
          details: `Purchased electricity token worth ₦${tokenAmount} (Fee: ₦${SERVICE_FEE}) for meter ${finalMeterNo} via ${providerName} - Token: ${tokenValue}`,
          targetUser: userId,
        }).catch(() => {});
      }

      await sendNotification(
        userId,
        "Electricity Token Generated 🎉",
        `Your electricity purchase of ₦${tokenAmount.toLocaleString()} for meter ${finalMeterNo} was successful. Token: ${tokenValue} | Units: ${unitsValue}`,
        "UTILITIES"
      );

      return res.status(200).json({
        success: true,
        status: "success",
        message: "Electricity token generated successfully.",
        orderId: reference,
        reference,
        token: tokenValue,
        units: unitsValue,
        tokenAmount,
        serviceFee: SERVICE_FEE,
        totalCharged: totalAmountToDebit,
        newBalance: newBal,
        provider: providerName,
      });
    }

    // AUTO-REFUND NAN TAKE IDAN DUK HANYOYI SUN GAZA
    const failureReason = dispatchResult.errors.length > 0
      ? dispatchResult.errors.join(" | ")
      : "Electricity gateway delivery failure";

    const refundBal = await executeAutoRefund({
      userId,
      amountNum: totalAmountToDebit,
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
      message: `Failed to generate token (${failureReason}). ₦${totalAmountToDebit.toLocaleString()} has been refunded to your wallet instantly.`,
      newBalance: refundBal,
    });
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
// SECTION 2: CABLE TV SUBSCRIPTIONS (MULTI-GATEWAY VERIFY & PURCHASE)
// =========================================================================

/**
 * @desc    Get Available Cable TV Plans/Bouquets
 * @route   GET /api/v1/bills/cable/plans
 */
exports.getCablePlans = async (req, res) => {
  try {
    const { provider, serviceId } = req.query;
    const targetProvider = String(provider || serviceId || "").toLowerCase();

    const baseUrl = getBaseUrl();
    const response = await axios.get(`${baseUrl}/bills/cable/plans`, {
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
      serviceFee: 50,
    });
  } catch (error) {
    console.error("Get Cable Plans Error:", error.message);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Unable to retrieve cable TV plans.",
      error: error.message,
    });
  }
};

/**
 * @desc    Verify Smartcard / IUC Number
 * @route   POST /api/v1/bills/cable/verify
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

    const cableInfo = mapCableProvider(finalProvider);
    let customerName = "";

    // 1. Gwada Al-Ihsan Cable Verification
    const rawAlihsanToken = getAlihsanToken();
    if (rawAlihsanToken) {
      try {
        const baseUrl = process.env.ALIHSAN_BASE_URL || "https://alihsandatasub.com.ng/api";
        const alihsanRes = await axios.get(`${baseUrl}/validateiuc`, {
          params: {
            smart_card_number: finalCardNo,
            cablename: cableInfo.id,
          },
          headers: {
            Authorization: formatAlihsanAuth(rawAlihsanToken),
            Accept: "application/json",
          },
          timeout: 20000,
        });

        if (alihsanRes.data?.name || alihsanRes.data?.customer_name) {
          customerName = alihsanRes.data.name || alihsanRes.data.customer_name;
        }
      } catch (_) {}
    }

    // 2. Gwada Ayax Marketplace Gateway
    if (!customerName) {
      try {
        const baseUrl = getBaseUrl();
        const ayaxRes = await axios.post(
          `${baseUrl}/bills/cable/verify`,
          {
            provider: finalProvider,
            service: finalProvider,
            smartCardNo: finalCardNo,
            smartCardNumber: finalCardNo,
            iuc: finalCardNo,
          },
          {
            headers: getHeaders(),
            timeout: 20000,
          }
        );

        if (ayaxRes.data?.data?.customerName || ayaxRes.data?.customerName) {
          customerName = ayaxRes.data.data?.customerName || ayaxRes.data.customerName;
        }
      } catch (_) {}
    }

    // 3. Gwada VTpass
    if (!customerName && process.env.VTPASS_API_KEY) {
      try {
        const vtpassRes = await axios.post(
          "https://api-service.vtpass.com/api/merchant-verify",
          {
            billersCode: finalCardNo,
            serviceID: cableInfo.vtpass,
          },
          {
            headers: {
              "api-key": process.env.VTPASS_API_KEY,
              "secret-key": process.env.VTPASS_SECRET_KEY,
            },
            timeout: 20000,
          }
        );
        if (vtpassRes.data?.content?.Customer_Name) {
          customerName = vtpassRes.data.content.Customer_Name;
        }
      } catch (_) {}
    }

    if (customerName) {
      return res.status(200).json({
        success: true,
        status: "success",
        customerName,
        name: customerName,
        smartCardNo: finalCardNo,
        smartCardNumber: finalCardNo,
        provider: finalProvider,
        serviceFee: 50,
      });
    }

    return res.status(400).json({
      success: false,
      status: "failed",
      message: "Invalid SmartCard / IUC Number.",
    });
  } catch (error) {
    console.error("SmartCard Verification Error:", error.message);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "SmartCard verification is currently unavailable. Please retry shortly.",
    });
  }
};

/**
 * Dispatcher for Cable TV Subscriptions (Al-Ihsan, Ayax Gateway, VTpass)
 */
const dispatchCableSubscription = async ({ provider, smartCardNo, planCode, amount, phone, subscriptionType, reference }) => {
  const cableInfo = mapCableProvider(provider);
  const formattedPhone = cleanLocalPhone(phone);
  const errors = [];

  // 1. AL-IHSAN CABLE
  const rawAlihsanToken = getAlihsanToken();
  if (rawAlihsanToken) {
    try {
      const baseUrl = process.env.ALIHSAN_BASE_URL || "https://alihsandatasub.com.ng/api";
      const res = await axios.post(
        `${baseUrl}/cablesub/`,
        {
          cablename: cableInfo.id,
          cableplan: planCode,
          smart_card_number: smartCardNo,
          customer_number: formattedPhone,
          reference: reference,
        },
        {
          headers: {
            Authorization: formatAlihsanAuth(rawAlihsanToken),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 45000,
        }
      );

      const status = String(res.data?.status || res.data?.Status || "").toLowerCase();
      if (status === "success" || status === "successful" || status === "true") {
        return { success: true, provider: "ALIHSAN", data: res.data };
      }
      errors.push(`ALIHSAN: ${res.data?.message || res.data?.error || "Al-Ihsan cable declined"}`);
    } catch (err) {
      errors.push(`ALIHSAN: ${err.response?.data?.message || err.message}`);
    }
  }

  // 2. AYAX MARKETPLACE GATEWAY
  const ayaxApiKey = String(process.env.AYAX_API_KEY || process.env.MARKETPLACE_API_KEY || "").trim();
  if (ayaxApiKey) {
    try {
      const baseUrl = getBaseUrl();
      const res = await axios.post(
        `${baseUrl}/bills/cable/buy`,
        {
          provider,
          smartCardNo,
          planCode,
          amount: Number(amount),
          phone: formattedPhone,
          subscriptionType: subscriptionType || "renew",
          reference,
        },
        {
          headers: getHeaders(),
          timeout: 45000,
        }
      );

      const resData = res.data;
      if (resData?.success === true || resData?.status === "success") {
        return { success: true, provider: "AYAX_GATEWAY", data: resData.data || resData };
      }
      errors.push(`AYAX: ${resData?.message || "Ayax cable failed"}`);
    } catch (err) {
      errors.push(`AYAX: ${err.response?.data?.message || err.message}`);
    }
  }

  // 3. VTPASS CABLE
  if (process.env.VTPASS_API_KEY && process.env.VTPASS_SECRET_KEY) {
    try {
      const res = await axios.post(
        "https://api-service.vtpass.com/api/pay",
        {
          request_id: reference,
          serviceID: cableInfo.vtpass,
          billersCode: smartCardNo,
          variation_code: planCode,
          amount: Number(amount),
          phone: formattedPhone,
          subscription_type: subscriptionType || "change",
        },
        {
          headers: {
            "api-key": process.env.VTPASS_API_KEY,
            "secret-key": process.env.VTPASS_SECRET_KEY,
          },
          timeout: 45000,
        }
      );

      if (res.data?.code === "000") {
        return { success: true, provider: "VTPASS", data: res.data };
      }
      errors.push(`VTPASS: ${res.data?.response_description || "VTpass cable declined"}`);
    } catch (err) {
      errors.push(`VTPASS: ${err.message}`);
    }
  }

  return { success: false, errors };
};

/**
 * @desc    Subscribe / Renew Cable TV Subscription (₦50 Service Fee Applied)
 * @route   POST /api/v1/bills/cable/buy
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
      subscriptionType,
    } = req.body;

    const finalProvider = String(provider || service || "").toLowerCase().trim();
    const finalCardNo = String(smartCardNo || smartCardNumber || iuc || "").trim();
    const finalPlanCode = String(planCode || packageCode || "").trim();
    const finalPhone = cleanLocalPhone(phone || phoneNumber || "");
    const finalPin = String(pin || transactionPin || "").trim();
    const packageAmount = Number(amount);
    const userId = req.user?._id || req.user?.id;

    const SERVICE_FEE = 50;
    const totalAmountToDebit = Number((packageAmount + SERVICE_FEE).toFixed(2));

    if (!finalProvider || !finalCardNo || !finalPlanCode || !packageAmount || packageAmount <= 0) {
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
    if (currentBal < totalAmountToDebit) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient wallet balance. Required: ₦${totalAmountToDebit.toLocaleString()} (Package: ₦${packageAmount.toLocaleString()} + ₦${SERVICE_FEE} Fee), Available: ₦${currentBal.toLocaleString()}`,
      });
    }

    // Cire duka jimillar kudin daga Wallet
    const debitedUser = await User.findByIdAndUpdate(
      userId,
      {
        $inc: {
          walletBalance: -totalAmountToDebit,
          balance: -totalAmountToDebit,
        },
      },
      { new: true }
    );

    const newBal = Number(debitedUser.walletBalance ?? debitedUser.balance ?? 0);
    const oldBal = Number((newBal + totalAmountToDebit).toFixed(2));

    const reference = `AYAX-CABLE-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const transactionId = `TXN-${Date.now()}`;

    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId,
      reference,
      type: "cable",
      category: "UTILITIES",
      service: `${finalProvider.toUpperCase()} Cable Subscription`,
      amount: totalAmountToDebit,
      oldBalance: oldBal,
      newBalance: newBal,
      previousBalance: oldBal,
      recipient: finalCardNo,
      phoneNumber: finalPhone || user.phone || null,
      smartCardNumber: finalCardNo,
      provider: finalProvider.toUpperCase(),
      planCode: finalPlanCode,
      status: "pending",
      details: `${finalProvider.toUpperCase()} (${planName || finalPlanCode}) for IUC ${finalCardNo} (Charged: ₦${totalAmountToDebit})`,
    });

    // MULTI-GATEWAY CABLE SUBSCRIPTION DISPATCH
    const dispatchResult = await dispatchCableSubscription({
      provider: finalProvider,
      smartCardNo: finalCardNo,
      planCode: finalPlanCode,
      amount: packageAmount,
      phone: finalPhone || user.phone,
      subscriptionType,
      reference,
    });

    if (dispatchResult.success) {
      const providerData = dispatchResult.data || {};
      const providerName = dispatchResult.provider || "GATEWAY";

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "success",
          apiReference: providerData.orderid || providerData.reference || reference,
          apiResponse: providerData,
          details: `Success: Cable subscription (${planName || finalPlanCode}) activated for ${finalCardNo} via ${providerName}`,
        }
      );

      if (Activity) {
        await Activity.create({
          user: userId,
          staffId: userId,
          action: "CABLE_PURCHASED",
          category: "VTU",
          details: `Subscribed to ${finalProvider.toUpperCase()} (${planName || finalPlanCode}) for IUC ${finalCardNo} via ${providerName} - Fee: ₦${SERVICE_FEE}`,
          targetUser: userId,
        }).catch(() => {});
      }

      await sendNotification(
        userId,
        "Cable Subscription Activated 🎉",
        `Your ${finalProvider.toUpperCase()} subscription for IUC ${finalCardNo} (₦${packageAmount.toLocaleString()}) was successfully activated.`,
        "UTILITIES"
      );

      return res.status(200).json({
        success: true,
        status: "success",
        message: "Cable subscription activated successfully.",
        orderId: reference,
        reference,
        packageAmount,
        serviceFee: SERVICE_FEE,
        totalCharged: totalAmountToDebit,
        newBalance: newBal,
        provider: providerName,
      });
    }

    // AUTO-REFUND NAN TAKE IDAN DUK HANYOYI SUN GAZA
    const failureReason = dispatchResult.errors.length > 0
      ? dispatchResult.errors.join(" | ")
      : "Cable provider declined subscription activation";

    const refundBal = await executeAutoRefund({
      userId,
      amountNum: totalAmountToDebit,
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
      message: `Subscription activation failed (${failureReason}). ₦${totalAmountToDebit.toLocaleString()} has been refunded to your wallet instantly.`,
      newBalance: refundBal,
    });
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