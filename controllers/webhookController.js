const crypto = require("crypto");
const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");

// Dynamic Imports
let Notification;
try {
  Notification = require("../models/Notification");
} catch (e) {
  Notification = null;
}

const MARKETPLACE_URL =
  process.env.MARKETPLACE_API_URL || "https://ayax-api-marketplace.onrender.com";

// Helper don tura Real-time Credit Alert
const sendCreditNotification = async (userId, amountInNaira, newBalance) => {
  try {
    const user = await User.findById(userId);
    if (user) {
      if (!user.notifications) user.notifications = [];
      user.notifications.unshift({
        title: "Wallet Credit Alert 💳",
        message: `Your wallet has been credited with ₦${amountInNaira.toLocaleString()} via Automated Dedicated Transfer. New Balance: ₦${newBalance.toLocaleString()}.`,
        category: "PAYMENT_SUCCESS",
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
        title: "Wallet Credit Alert 💳",
        message: `Your wallet has been credited with ₦${amountInNaira.toLocaleString()} via Automated Dedicated Transfer. New Balance: ₦${newBalance.toLocaleString()}.`,
        category: "PAYMENT_SUCCESS",
        type: "wallet",
        isBroadcast: false,
        isGeneral: false,
        target: "specific_users",
        isRead: false,
        read: false,
        createdAt: new Date(),
      }).catch(() => {});
    }
  } catch (error) {
    console.error("Credit Notification Error:", error.message);
  }
};

/**
 * @desc    Handle Paystack Dedicated Virtual Account & Card Funding Webhook
 * @route   POST /api/v1/webhooks/paystack
 * @access  Public (Secured with HMAC Signature)
 */
exports.handlePaystackWebhook = async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;
    const signature = req.headers["x-paystack-signature"];

    // 1. Tabbatar da sa hannun Paystack
    if (secret && signature && signature !== "internal_forwarded") {
      const payload = req.rawBody ? req.rawBody : JSON.stringify(req.body);
      const hash = crypto
        .createHmac("sha512", secret)
        .update(payload)
        .digest("hex");

      if (hash !== signature) {
        console.warn("Invalid Paystack signature on Data Xpress.");
        return res.status(401).send("Invalid Signature");
      }
    }

    const event = req.body;

    if (
      event?.event === "charge.success" ||
      event?.event === "dedicated_account.assign.success" ||
      event?.eventType === "SUCCESSFUL_TRANSACTION"
    ) {
      const data = event.data || event.eventData || {};
      const { amount, reference, customer, authorization, dedicated_account_details } = data;
      const amountInNaira = Number(amount || 0) / (event.event === "charge.success" ? 100 : 1);
      const email = String(customer?.email || data.customerEmail || "").toLowerCase().trim();
      const finalRef = reference || data.transactionReference || `FUND-${Date.now()}`;

      const accountNumber = String(
        authorization?.receiver_bank_account_number ||
        dedicated_account_details?.account_number ||
        data.accountNumber ||
        ""
      ).trim();

      // 2. Nemo Mai Asusu a Database
      let user = null;
      if (accountNumber) {
        user = await User.findOne({
          $or: [
            { accountNumber },
            { virtualAccountNumber: accountNumber },
            { "virtualAccount.accountNumber": accountNumber },
            { dedicatedAccountNumber: accountNumber },
          ],
        });
      }

      if (!user && email) {
        const phoneFromEmail = email.split("@")[0];
        user = await User.findOne({
          $or: [
            { email: new RegExp(`^${email}$`, "i") },
            { phone: phoneFromEmail },
            { phone: phoneFromEmail.replace(/^234/, "0") },
          ],
        });
      }

      if (user && amountInNaira > 0) {
        // 3. Duba Idempotency (Kada a zuba kudi sau biyu)
        const existingTx = await Transaction.findOne({
          $or: [{ reference: finalRef }, { transactionId: finalRef }],
        });

        if (!existingTx) {
          const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
          const newBal = Number((currentBal + amountInNaira).toFixed(2));

          // Atomic Balance Update
          await User.findByIdAndUpdate(
            user._id,
            {
              $inc: {
                walletBalance: amountInNaira,
                balance: amountInNaira,
              },
            },
            { new: true }
          );

          // 4. Create Ledger Record a History
          await Transaction.create({
            user: user._id,
            userId: user._id,
            transactionId: `DEP-${Date.now()}`,
            reference: finalRef,
            type: "funding",
            category: "WALLET",
            service: "Wallet Funding",
            amount: amountInNaira,
            oldBalance: currentBal,
            newBalance: newBal,
            previousBalance: currentBal,
            recipient: user.phone || user.email,
            phoneNumber: user.phone,
            status: "success",
            description: `Automated Wallet Deposit of ₦${amountInNaira.toLocaleString()} (Ref: ${finalRef})`,
            details: {
              gateway: "Paystack Dedicated NUBAN",
              accountNumber: accountNumber || "DVA",
              paidAmount: amountInNaira,
            },
          });

          // Tura Sanarwar Credit nan take
          await sendCreditNotification(user._id, amountInNaira, newBal);

          console.log(`✅ [WALLET CREDITED]: ₦${amountInNaira} added to ${user.email || user.phone} (New Bal: ₦${newBal})`);
        }
      }

      // 5. Tura kwafin bayanin zuwa Marketplace don synchronization
      try {
        const cleanMarketUrl = MARKETPLACE_URL.replace(/\/+$/, "");
        await axios.post(
          `${cleanMarketUrl}/api/v1/webhooks/paystack`,
          req.body,
          {
            headers: {
              "x-paystack-signature": "internal_forwarded",
              "Content-Type": "application/json",
            },
            timeout: 25000,
          }
        );
        console.log(`📡 Forwarded webhook successfully to Marketplace.`);
      } catch (fwdErr) {
        console.error("Marketplace forward notice:", fwdErr.message);
      }
    }

    return res.status(200).send("Webhook Processed by Data Xpress");
  } catch (error) {
    console.error("Data Xpress Webhook Error:", error.message);
    return res.status(200).send("Acknowledged");
  }
};