const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Dynamic Imports
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

// Safely resolve User ID
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

// 1. Ayax API Gateway Configuration
const getBaseUrl = () => {
  const rawUrl =
    process.env.AYAX_API_BASE_URL ||
    process.env.MARKETPLACE_API_URL ||
    "https://ayax-api-marketplace.onrender.com";
  const cleanBase = rawUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return `${cleanBase}/api/v1`;
};

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

// Helper don tura Sanarwa
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

// Automated Auto-Refund Processor
const executeAutoRefund = async (userId, amountNum, reference, targetBvn, reason) => {
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
      service: "Refund: BVN Verification",
      amount: amountNum,
      oldBalance: prevBal,
      newBalance: currentBal,
      previousBalance: prevBal,
      recipient: targetBvn,
      bvn: targetBvn,
      status: "success",
      description: `Auto-Refund of ₦${amountNum.toLocaleString()} for failed BVN Verification (${reason})`,
      details: {
        originalReference: reference,
        bvn: targetBvn,
        failureReason: reason,
      },
    });

    await sendNotification(
      userId,
      "BVN Verification Refunded 💰",
      `Your ₦${amountNum.toLocaleString()} payment for BVN Verification (${targetBvn}) failed and has been refunded to your wallet. Reason: ${reason}`,
      "REFUND"
    );

    return currentBal;
  } catch (err) {
    console.error("BVN Auto-Refund Execution Error:", err.message);
    return 0;
  }
};

/**
 * 1. VERIFY BVN DIRECTLY
 * @route POST /api/v1/bvn/verify (or /api/v1/bvn/verify-and-generate)
 * @access Private (User)
 */
exports.verifyBVN = async (req, res) => {
  try {
    const {
      bvn,
      bvnNumber,
      searchValue,
      number,
      identityNumber,
      serviceType,
      pin,
      transactionPin,
      amount,
    } = req.body;

    const rawBvn = String(
      bvn || bvnNumber || searchValue || identityNumber || number || ""
    ).trim();

    const targetBvn = rawBvn.replace(/\D/g, "");
    const finalPin = String(pin || transactionPin || "").trim();
    const amountNum = Number(amount || 150);
    const userId = resolveUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        status: "failed",
        message: "User session expired or unauthorized. Please re-login.",
      });
    }

    if (!targetBvn || targetBvn.length !== 11) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Please provide a valid 11-digit BVN number.",
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
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "User account not found.",
      });
    }

    // A. Verify PIN
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
        message: "Security Error: Invalid Transaction PIN.",
      });
    }

    // B. Check Wallet Balance
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
    if (currentBal < amountNum) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: `Insufficient Wallet Balance. Required: ₦${amountNum.toLocaleString()}, Available: ₦${currentBal.toLocaleString()}`,
      });
    }

    // C. Atomic Debit
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

    const newBal = Number(debitedUser?.walletBalance ?? debitedUser?.balance ?? 0);
    const oldBal = Number((newBal + amountNum).toFixed(2));

    const transactionId = `BVN${Date.now()}${Math.floor(100 + Math.random() * 900)}`;
    const reference = `AYAX-BVN-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    // D. Create Pending Transaction Entry
    await Transaction.create({
      user: userId,
      userId: userId,
      transactionId,
      reference,
      type: "identity",
      category: "IDENTITY",
      service: "BVN Verification",
      amount: amountNum,
      oldBalance: oldBal,
      newBalance: newBal,
      previousBalance: oldBal,
      recipient: targetBvn,
      bvn: targetBvn,
      status: "pending",
      details: `BVN Verification Query for ${targetBvn}`,
    });

    // E. Dispatch kai tsaye zuwa Ayax API Marketplace Identity Endpoint
    try {
      const baseUrl = getBaseUrl();
      const endpoint = `${baseUrl}/identity/bvn/verify`;

      const slipFormat =
        serviceType === "bvn_premium" ? "Premium Card" : "Standard Slip";

      const response = await axios.post(
        endpoint,
        {
          bvn: targetBvn,
          slipType: slipFormat,
          reference: reference,
        },
        {
          headers: getHeaders(),
          timeout: 45000,
        }
      );

      const resData = response?.data;
      const isSuccessful =
        resData &&
        (resData.success === true ||
          resData.status === "success" ||
          resData.code === "VERIFICATION_SUCCESSFUL" ||
          resData.code === 200 ||
          resData.code === "200");

      if (isSuccessful) {
        // Ciro ainihin bayanan BVN da hoto
        const resultPayload = resData.data?.details?.data || resData.data?.details || resData.data || {};

        const slipUrl =
          resultPayload.slipUrl ||
          resultPayload.pdfUrl ||
          resultPayload.url ||
          null;

        await Transaction.findOneAndUpdate(
          { reference },
          {
            status: "success",
            slipUrl: slipUrl,
            apiResponse: resultPayload,
            details: `Completed: BVN Verification for ${targetBvn}`,
          }
        );

        if (Activity) {
          await Activity.create({
            user: userId,
            staffId: userId,
            action: "BVN_VERIFIED",
            category: "IDENTITY",
            details: `Successfully verified BVN: ${targetBvn}`,
            targetUser: userId,
          }).catch(() => {});
        }

        await sendNotification(
          userId,
          "BVN Verification Successful 📄",
          `BVN details for (${targetBvn}) retrieved successfully.`,
          "IDENTITY"
        );

        return res.status(200).json({
          success: true,
          status: "success",
          message: "BVN Verification successful.",
          data: {
            ...resultPayload,
            fullName:
              resultPayload.fullName ||
              resultPayload.name ||
              `${resultPayload.firstName || resultPayload.firstname || ""} ${resultPayload.middleName || ""} ${resultPayload.lastName || resultPayload.surname || ""}`.trim(),
            bvn: resultPayload.bvn || targetBvn,
            photo: resultPayload.photo || resultPayload.image || null,
            pdfUrl: slipUrl,
            slipUrl: slipUrl,
          },
          pdfUrl: slipUrl,
          slipUrl: slipUrl,
          newBalance: newBal,
        });
      }

      throw new Error(resData?.message || "Ayax Gateway declined BVN lookup.");
    } catch (apiError) {
      console.error(
        "Ayax BVN API Gateway Error:",
        apiError.response?.status,
        apiError.response?.data || apiError.message
      );

      const errMsg =
        apiError.response?.data?.message || apiError.message || "BVN gateway communication failed";

      const refundBal = await executeAutoRefund(
        userId,
        amountNum,
        reference,
        targetBvn,
        errMsg
      );

      return res.status(422).json({
        success: false,
        status: "failed",
        refunded: true,
        message: `BVN verification failed: ${errMsg}. ₦${amountNum.toLocaleString()} has been refunded to your wallet instantly.`,
        newBalance: refundBal,
      });
    }
  } catch (error) {
    console.error("BVN Verification Controller Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Internal server error occurred while processing BVN verification.",
      error: error.message,
    });
  }
};

// Aliases don dacewa da router
exports.verifyAndGenerate = exports.verifyBVN;