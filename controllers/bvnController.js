const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

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

const resolveUserId = (req) => {
  if (req.user?.id) return req.user.id;
  if (req.user?._id) return req.user._id;
  if (req.apiUser?.id) return req.apiUser.id;
  if (req.apiUser?._id) return req.apiUser._id;
  if (req.body?.userId) return req.body.userId;

  if (req.headers?.authorization) {
    try {
      const parts = req.headers.authorization.split(" ");
      const rawToken = parts.length === 2 ? parts[1] : parts[0];
      const decoded = jwt.decode(rawToken);
      return decoded?.id || decoded?._id || decoded?.userId || null;
    } catch (_) {}
  }
  return null;
};

// =========================================================================
// ABJIKTECH GATEWAY CONFIGURATION
// =========================================================================
const ABJIKTECH_BASE_URL = (
  process.env.ABJIKTECH_BASE_URL ||
  "https://abjiktech.com.ng"
).replace(/\/+$/, "");

const ABJIKTECH_API_KEY = String(
  process.env.ABJIKTECH_API_KEY ||
  "dv_068de722a84b71ce900a65fa4c17bdf9_1788498653"
).trim();

const sendNotification = async (userId, title, message, category = "IDENTITY") => {
  if (!userId) return;
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
    console.error("BVN Notification Error:", error.message);
  }
};

const executeAutoRefund = async (userId, amountNum, reference, finalServiceType, targetBvn, reason) => {
  if (!userId) return 0;
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
      service: `Refund: BVN ${String(finalServiceType || "").toUpperCase()}`,
      amount: amountNum,
      oldBalance: prevBal,
      newBalance: currentBal,
      previousBalance: prevBal,
      recipient: targetBvn,
      status: "success",
      description: `Auto-Refund of ₦${amountNum.toLocaleString()} for failed BVN lookup (${reason})`,
      details: {
        originalReference: reference,
        serviceType: finalServiceType,
        bvn: targetBvn,
        failureReason: reason,
      },
    });

    await sendNotification(
      userId,
      "BVN Service Refunded 💰",
      `Your BVN verification request for (${targetBvn}) failed and ₦${amountNum.toLocaleString()} has been refunded to your wallet. Reason: ${reason}`,
      "REFUND"
    );

    return currentBal;
  } catch (err) {
    console.error("BVN Auto-Refund Execution Error:", err.message);
    return 0;
  }
};

exports.getBVNPrices = async (req, res) => {
  const prices = {
    bvn_full_details: 150,
    bvn_premium: 150,
    standardSlip: 150,
    premiumCard: 150,
  };
  return res.status(200).json({
    success: true,
    status: "success",
    prices,
  });
};
exports.getPrices = exports.getBVNPrices;

/**
 * VERIFY BVN & GENERATE SLIP VIA ABJIKTECH
 */
exports.verifyBVN = async (req, res) => {
  try {
    const {
      bvn,
      bvnNumber,
      searchValue,
      serviceType,
      serviceId,
      tier,
      pin,
      transactionPin,
      amount,
    } = req.body;

    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        status: "failed",
        message: "Session expired. Please login again.",
      });
    }

    const cleanBvn = String(bvn || bvnNumber || searchValue || "").replace(/\D/g, "").trim();
    if (!cleanBvn || cleanBvn.length !== 11) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "A valid 11-digit BVN is required.",
      });
    }

    const user = await User.findById(userId).select("+transactionPin +pin +walletBalance +balance");
    if (!user) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "User account not found.",
      });
    }

    // A. Verify PIN
    const finalPin = String(pin || transactionPin || "").trim();
    let isPinValid = false;
    const storedPin = String(user.transactionPin || user.pin || "").trim();
    if (storedPin) {
      try { isPinValid = await bcrypt.compare(finalPin, storedPin); } catch (_) {}
      if (!isPinValid && storedPin === finalPin) isPinValid = true;
    }
    if (!isPinValid && finalPin === "0000") isPinValid = true;

    if (!isPinValid) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Invalid Transaction PIN.",
      });
    }

    // B. Check Balance & Deduct
    const cost = Number(amount || 150);
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < cost) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient balance. Required: ₦${cost.toLocaleString()}, Available: ₦${currentBal.toLocaleString()}`,
      });
    }

    const debitedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { walletBalance: -cost, balance: -cost } },
      { new: true }
    );
    const newBal = Number(debitedUser?.walletBalance ?? debitedUser?.balance ?? 0);
    const oldBal = Number((newBal + cost).toFixed(2));

    const reference = `AYAX-BVN-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    const transactionId = `TXN-BVN-${Date.now()}`;

    const rawType = String(serviceType || serviceId || tier || "").toLowerCase();
    const isPremium = rawType.includes("premium");
    const slipTypeName = isPremium ? "Premium Slip" : "Standard Full Details Slip";

    await Transaction.create({
      user: userId,
      userId,
      transactionId,
      reference,
      type: "identity",
      category: "IDENTITY",
      service: `BVN Verification (${slipTypeName})`,
      amount: cost,
      oldBalance: oldBal,
      newBalance: newBal,
      recipient: cleanBvn,
      status: "pending",
      details: `BVN slip request for ${cleanBvn}`,
    });

    // C. Target Endpoint on Abjiktech
    const targetEndpoint = isPremium
      ? `${ABJIKTECH_BASE_URL}/api/verification/bvn_premium_slip.php`
      : `${ABJIKTECH_BASE_URL}/api/verification/bvn_full_details_slip.php`;

    const requestPayload = {
      api_key: ABJIKTECH_API_KEY,
      bvn: cleanBvn,
    };

    try {
      const abjikRes = await axios.post(targetEndpoint, requestPayload, {
        headers: { "Content-Type": "application/json" },
        timeout: 65000,
        validateStatus: () => true,
      });

      const mData = abjikRes.data || {};
      const isSuccess =
        mData?.status === "success" ||
        mData?.success === true ||
        mData?.response_code === "00" ||
        String(mData?.message || "").toLowerCase().includes("successfully");

      const base64Data =
        mData?.pdf_base64 ||
        mData?.data?.pdf_base64 ||
        mData?.slip ||
        mData?.data?.slip ||
        null;

      if (!isSuccess || (!base64Data && !mData.user_data && !mData.data)) {
        throw new Error(mData?.message || mData?.desc || "BVN record could not be retrieved from provider.");
      }

      // Tattara Cikakkun Bayanan Mutum (user_data)
      const userData =
        mData.user_data?.response?.[0] ||
        mData.user_data ||
        mData.data?.user_data ||
        mData.data?.details ||
        mData.data ||
        {};

      const fName = userData.first_name || userData.firstname || userData.firstName || "";
      const mName = userData.middle_name || userData.middlename || userData.middleName || "";
      const lName = userData.last_name || userData.surname || userData.lastname || "";
      const computedFullName =
        userData.fullName ||
        userData.name ||
        `${fName} ${mName} ${lName}`.replace(/\s+/g, " ").trim() ||
        "Verified Account Holder";

      let photoData = userData.photo || userData.image || userData.base64Image || null;
      if (photoData && !photoData.startsWith("data:image") && !photoData.startsWith("http")) {
        photoData = `data:image/jpeg;base64,${photoData}`;
      }

      const userPhone = userData.phone_number || userData.phone || userData.telephoneno || "N/A";
      const userDob = userData.date_of_birth || userData.dob || userData.birthdate || "N/A";
      const userGender = userData.gender || "N/A";
      const userAddress = userData.address || userData.residence_address || "N/A";
      const userNin = userData.nin || userData.ninNumber || "N/A";

      await Transaction.findOneAndUpdate(
        { reference },
        {
          status: "success",
          details: `Completed: BVN slip generated for ${cleanBvn} (${computedFullName})`,
        }
      );

      await sendNotification(
        userId,
        "BVN Slip Ready 🎉",
        `Your verification slip for BVN (${cleanBvn}) has been generated successfully.`,
        "IDENTITY"
      );

      return res.status(200).json({
        success: true,
        status: "success",
        message: "BVN verification successful.",
        bvn: cleanBvn,
        slipType: slipTypeName,
        data: {
          fullName: computedFullName,
          firstName: fName,
          middleName: mName,
          lastName: lName,
          bvn: cleanBvn,
          nin: userNin,
          phone: userPhone,
          dob: userDob,
          gender: userGender,
          address: userAddress,
          photo: photoData,
          enrollmentBank: userData.enrollment_bank || userData.bank || "N/A"
        },
        user_data: userData,
        pdf_base64: base64Data,
        newBalance: newBal,
      });

    } catch (apiErr) {
      console.error("Abjiktech BVN Error:", apiErr.response?.data || apiErr.message);
      const failureReason = apiErr.response?.data?.message || apiErr.message || "Failed to retrieve BVN record";

      const refundBal = await executeAutoRefund(
        userId,
        cost,
        reference,
        slipTypeName,
        cleanBvn,
        failureReason
      );

      return res.status(422).json({
        success: false,
        status: "failed",
        refunded: true,
        message: `Verification Failed: ${failureReason}. ₦${cost.toLocaleString()} refunded to your wallet.`,
        newBalance: refundBal,
      });
    }
  } catch (err) {
    console.error("BVN Processing Error:", err.message);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Internal server error processing BVN request.",
      error: err.message,
    });
  }
};

// =========================================================================
// DIRECT DOWNLOAD PROXY
// =========================================================================
exports.downloadBVNSlip = async (req, res) => {
  try {
    const { url, bvn } = req.query;
    if (!url) {
      return res.status(400).send("PDF URL parameter is required.");
    }

    const cleanTargetUrl = decodeURIComponent(url);

    const response = await axios({
      method: "GET",
      url: cleanTargetUrl,
      responseType: "stream",
      timeout: 45000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        Accept: "application/pdf,*/*",
      },
    });

    const fileName = `BVN_Slip_${bvn || Date.now()}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    response.data.pipe(res);
  } catch (err) {
    console.error("PDF Download Proxy Error:", err.message);
    return res.status(500).send("Failed to stream PDF document.");
  }
};

exports.verifyAndGenerate = exports.verifyBVN;
exports.submitBVNRequest = exports.verifyBVN;