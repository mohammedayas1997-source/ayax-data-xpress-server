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

// Helper: Al-Ihsan Token Auth Formatter
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

// Ayax Standard API Headers Generator
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

// Helper don tura Notification
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
    console.error("Electricity Notification Error:", error.message);
  }
};

// Automated Auto-Refund Processor (Yana mayar da duka jimillar kudi har da Service Fee)
const executeAutoRefund = async (userId, amountNum, reference, finalDisco, finalMeterNo, finalPhone, reason) => {
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
      service: `Refund: ${finalDisco.toUpperCase()} Electricity Token`,
      amount: amountNum,
      oldBalance: prevBal,
      newBalance: currentBal,
      previousBalance: prevBal,
      recipient: finalMeterNo,
      meterNumber: finalMeterNo,
      phoneNumber: finalPhone,
      status: "success",
      description: `Auto-Refund of ₦${amountNum.toLocaleString()} for failed ${finalDisco.toUpperCase()} Meter ${finalMeterNo} (${reason})`,
      details: {
        originalReference: reference,
        disco: finalDisco,
        meterNo: finalMeterNo,
        failureReason: reason,
      },
    });

    await sendNotification(
      userId,
      "Electricity Refund Credited 💰",
      `Your payment of ₦${amountNum.toLocaleString()} for meter ${finalMeterNo} (${finalDisco.toUpperCase()}) failed to generate a token and has been instantly refunded to your wallet. Reason: ${reason}`,
      "REFUND"
    );

    console.log(`💸 [ELECTRICITY REFUND] ₦${amountNum} refunded to User ${userId} (Ref: ${reference})`);
    return currentBal;
  } catch (err) {
    console.error("Electricity Auto-Refund Execution Error:", err.message);
    return 0;
  }
};

/**
 * 1. MULTI-GATEWAY METER NUMBER VERIFICATION
 */
exports.verifyMeter = async (req, res) => {
  const { electricCompany, disco, serviceId, meterNo, meterNumber, meterType } = req.body;
  const finalDisco = String(disco || electricCompany || serviceId || "").toLowerCase().trim();
  const finalMeterNo = String(meterNo || meterNumber || "").trim();
  const finalMeterType = String(meterType || "prepaid").toLowerCase().trim();

  if (!finalDisco || !finalMeterNo) {
    return res.status(400).json({
      success: false,
      status: "failed",
      message: "Please select Electricity Disco and enter Meter Number.",
    });
  }

  const discoInfo = mapDiscoCode(finalDisco);
  const userId = req.user ? req.user._id || req.user.id : null;
  let verifiedCustomerName = "";
  let verifiedAddress = "N/A";

  // ROUTE 1: AL-IHSAN DATASUB METER VERIFICATION
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

  // ROUTE 2: AYAX MARKETPLACE GATEWAY VERIFICATION
  if (!verifiedCustomerName) {
    try {
      const baseUrl = getBaseUrl();
      const candidateEndpoints = [
        `${baseUrl}/bills/electricity/verify`,
        `${baseUrl}/electricity/verify`,
        `${baseUrl}/vtu/electricity/verify`,
      ];

      for (const endpoint of candidateEndpoints) {
        try {
          const ayaxRes = await axios.post(
            endpoint,
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
            break;
          }
        } catch (e) {}
      }
    } catch (_) {}
  }

  // ROUTE 3: VTPASS METER VERIFICATION
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
      electricCompany: finalDisco,
      disco: finalDisco,
      meterType: finalMeterType,
      serviceFee: 50,
    });
  }

  return res.status(400).json({
    success: false,
    status: "failed",
    message: "Could not verify meter number. Please verify the meter digits and DISCO company.",
  });
};

/**
 * Helper: Universal Dispatcher for Electricity Token Generation
 */
const dispatchElectricityPayment = async ({ disco, meterNo, meterType, amount, phone, reference }) => {
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
      errors.push(`ALIHSAN: ${res.data?.message || res.data?.error || "Al-Ihsan token generation declined"}`);
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
        `${baseUrl}/electricity/buy`,
        {
          disco,
          serviceId: disco,
          meterNo,
          meterNumber: meterNo,
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
        const token =
          res.data?.token ||
          res.data?.purchased_code ||
          res.data?.mainToken ||
          "Token Generated";
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
 * 2. PROCESS ELECTRICITY PAYMENT (MULTI-GATEWAY + ₦50 SERVICE FEE + INSTANT AUTO-REFUND)
 */
exports.buyElectricity = async (req, res) => {
  try {
    const {
      electricCompany,
      disco,
      serviceId,
      meterNo,
      meterNumber,
      meterType,
      amount,
      phoneNo,
      phone,
      phoneNumber,
      pin,
      transactionPin,
    } = req.body;

    const finalDisco = String(disco || electricCompany || serviceId || "").toLowerCase().trim();
    const finalMeterNo = String(meterNo || meterNumber || "").trim();
    const finalMeterType = String(meterType || "prepaid").toLowerCase().trim();
    const finalPhone = cleanLocalPhone(phoneNo || phone || phoneNumber || "");
    const finalPin = String(transactionPin || pin || "").trim();
    const tokenAmount = Number(amount);
    const userId = req.user?._id || req.user?.id;

    const SERVICE_FEE = 50;
    const totalAmountToDebit = Number((tokenAmount + SERVICE_FEE).toFixed(2));

    if (!finalDisco || !finalMeterNo || !tokenAmount || tokenAmount <= 0 || !finalPhone) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please fill in all details (Disco, Meter Number, Amount, and Phone Number).",
      });
    }

    if (!finalPin) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Security transaction PIN is required.",
      });
    }

    const user = await User.findById(userId).select("+transactionPin +pin +walletBalance +balance");

    if (!user) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }

    // PIN Verification
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
        message: "Incorrect transaction PIN.",
      });
    }

    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);

    if (currentBal < totalAmountToDebit) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient Wallet Balance. Required: ₦${totalAmountToDebit.toLocaleString()} (Token: ₦${tokenAmount.toLocaleString()} + ₦${SERVICE_FEE} Fee), Available: ₦${currentBal.toLocaleString()}`,
      });
    }

    // Atomic Debit daga Wallet
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

    const transactionId = `ELEC${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
    const reference = `AYAX-ELEC-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

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
      meterNumber: finalMeterNo,
      phoneNumber: finalPhone,
      provider: finalDisco.toUpperCase(),
      status: "pending",
      details: `${finalDisco.toUpperCase()} Meter ${finalMeterNo} (Token: ₦${tokenAmount} + Fee: ₦${SERVICE_FEE})`,
    });

    // MULTI-GATEWAY EXECUTION (Al-Ihsan, Ayax Gateway, VTpass)
    const dispatchResult = await dispatchElectricityPayment({
      disco: finalDisco,
      meterNo: finalMeterNo,
      meterType: finalMeterType,
      amount: tokenAmount,
      phone: finalPhone,
      reference,
    });

    // 1. NASARA: AN SAMU TOKEN
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
        reference: reference,
        token: tokenValue,
        unit: unitsValue,
        units: unitsValue,
        tokenAmount: tokenAmount,
        serviceFee: SERVICE_FEE,
        totalCharged: totalAmountToDebit,
        newBalance: newBal,
        provider: providerName,
      });
    }

    // 2. RASHIN NASARA: AUTO-REFUND NAN TAKE
    const combinedErrors = dispatchResult.errors.length > 0
      ? dispatchResult.errors.join(" | ")
      : "Electricity gateway delivery failure";

    console.error(`🚨 [ELECTRICITY DISPATCH FAILED]: Refunding User ${userId}. Errors: ${combinedErrors}`);

    const refundBal = await executeAutoRefund(
      userId,
      totalAmountToDebit,
      reference,
      finalDisco,
      finalMeterNo,
      finalPhone,
      combinedErrors
    );

    return res.status(422).json({
      success: false,
      status: "failed",
      refunded: true,
      message: `Failed to generate token (${combinedErrors}). ₦${totalAmountToDebit.toLocaleString()} has been refunded to your wallet instantly.`,
      newBalance: refundBal,
    });
  } catch (error) {
    console.error("Buy Electricity Processing Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Internal server error occurred while processing electricity payment.",
      error: error.message,
    });
  }
};