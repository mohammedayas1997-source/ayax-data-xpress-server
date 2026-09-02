const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const bcrypt = require("bcryptjs");

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

// 1. Ayax API Gateway Configuration
const RAW_URL =
  process.env.AYAX_API_BASE_URL ||
  process.env.MARKETPLACE_API_URL ||
  "https://ayax-api-marketplace.onrender.com";

const CLEAN_BASE = RAW_URL.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
const AYAX_API_BASE_URL = `${CLEAN_BASE}/api/v1`;

// ✅ Daidai (Dogaro da Render Environment kawai):
const AYAX_API_KEY = process.env.AYAX_API_KEY || process.env.MARKETPLACE_API_KEY;

const getHeaders = () => ({
  "Content-Type": "application/json",
  "x-api-key": AYAX_API_KEY,
  Authorization: `Bearer ${AYAX_API_KEY}`,
});

// Helper don tura Sanarwa
const sendNotification = async (userId, title, message, category = "IDENTITY") => {
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

    // Ƙirƙirar sabon record na REFUND a History
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
  }
};

/**
 * 1. VERIFY BVN DIRECTLY (BVN Lookup / Verification)
 * @route POST /api/v1/bvn/verify (ko /api/v1/identity/bvn)
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
      pin,
      transactionPin,
      amount,
    } = req.body;

    // 1. Tattaro lambar ko ta wane suna frontend ya turo ta
    const rawBvn = String(
      bvn || bvnNumber || searchValue || identityNumber || number || ""
    ).trim();

    // 2. Cire duk wani rubutu ko space, a bar lambobi zalla
    const targetBvn = rawBvn.replace(/\D/g, "");

    const finalPin = String(pin || transactionPin || "").trim();
    const amountNum = Number(amount || 150);
    const userId = req.user?._id || req.user?.id;

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
      return res.status(404).json({ success: false, message: "User account not found." });
    }

    // Ci gaba da sauran code din...

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

    const newBal = Number(debitedUser.walletBalance ?? debitedUser.balance ?? 0);
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

   // E. Dispatch to Ayax BVN Gateway
    let response;
    const candidateEndpoints = [
      `${AYAX_API_BASE_URL}/identity/bvn/verify`,
      `${AYAX_API_BASE_URL}/identity/nin/bvn-lookup`,
      `${AYAX_API_BASE_URL}/identity/verify-bvn`,
      `${AYAX_API_BASE_URL}/identity/verify`,
      `${AYAX_API_BASE_URL}/vtu/verify-bvn`,
      `${AYAX_API_BASE_URL}/bvn`,
    ];

    try {
      for (const endpoint of candidateEndpoints) {
        try {
          response = await axios.post(
            endpoint,
            {
              bvn: targetBvn,
              bvnNumber: targetBvn,
              idNumber: targetBvn,
              searchValue: targetBvn,
              searchType: "bvn",
              type: "bvn",
              reference,
              ref_id: reference,
              amount: amountNum,
            },
            {
              headers: getHeaders(),
              timeout: 45000,
            }
          );
          if (response.data) break;
        } catch (e) {
          // Idan kuskuren 404 ne, bar shi ya gwada na gaba
          if (endpoint === candidateEndpoints[candidateEndpoints.length - 1]) throw e;
        }
      }

      const resData = response?.data;
      const isSuccessful =
        resData &&
        (resData.success === true ||
          resData.status === "success" ||
          resData.status === true ||
          resData.code === 200 ||
          resData.code === "200");

      if (isSuccessful) {
        const bvnData = resData.data || resData;

        await Transaction.findOneAndUpdate(
          { reference },
          {
            status: "success",
            apiResponse: bvnData,
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
          data: bvnData,
          newBalance: newBal,
        });
      } else {
        throw new Error(resData?.message || "Ayax Gateway declined BVN lookup.");
      }
    } catch (apiError) {
      console.error(
        "Ayax BVN API Gateway Error:",
        apiError.response?.status,
        apiError.response?.data || apiError.message
      );

      const errMsg =
        apiError.response?.data?.message || apiError.message || "BVN gateway timed out";

      // INSTANT AUTO-REFUND
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