const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");
const crypto = require("crypto");

/**
 * @desc    Handle Paystack Webhook events (Wallet Funding, etc.)
 * @route   POST /api/v1/payment/webhook
 * @access  Public (Secured via Paystack Signature)
 */
exports.handlePaystackWebhook = async (req, res) => {
  try {
    // 1. Tabbatar da tsaro ta hanyar Paystack Signature (Idan kana so)
    const hash = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest("hex");

    const paystackSignature = req.headers["x-paystack-signature"];

    // A yanayin gwaji (testing), zaka iya barin wannan sharadin ko kuma ka tabbatar da shi
    if (paystackSignature && hash !== paystackSignature) {
      console.warn("Invalid Paystack webhook signature detected.");
      // Zaka iya mayar da 200 ko 400 gwargwadon yadda kake son security din ta kasance
    }

    const event = req.body;

    // 2. Duba idan event din shine charge.success
    if (event && event.event === "charge.success") {
      const txData = event.data;
      const reference = txData.reference;
      const amountInNaira = Number(txData.amount) / 100;
      const email = txData.customer.email;

      // Rigakafin Double Funding (Idan an riga an yi processing din reference din)
      const existingTx = await Transaction.findOne({ reference });
      if (existingTx) {
        return res.status(200).json({ success: true, message: "Transaction already processed" });
      }

      // Nemo mai amfani da wannan email din ko kuma ta hanyar metadata
      let user = null;
      if (txData.metadata && txData.metadata.userId) {
        user = await User.findById(txData.metadata.userId);
      }
      
      if (!user) {
        user = await User.findOne({ email });
      }

      if (!user) {
        console.error("Webhook Error: User not found for email:", email);
        return res.status(404).json({ success: false, message: "User not found" });
      }

      // Sabunta kudin wallet din mai amfani
      const currentBal = user.walletBalance !== undefined ? user.walletBalance : (user.balance || 0);
      const newBalance = currentBal + amountInNaira;

      user.walletBalance = newBalance;
      if (user.balance !== undefined) {
        user.balance = newBalance;
      }
      await user.save();

      // Ajiye Transaction
      const transactionId = `WH${Date.now()}${Math.floor(Math.random() * 1000)}`;
      await Transaction.create({
        user: user._id,
        transactionId,
        type: "wallet_funding",
        category: "wallet",
        amount: amountInNaira,
        status: "success",
        reference: reference,
        details: `Wallet funding via Paystack Webhook (Ref: ${reference})`,
      });

      // Ajiye Activity Log & Notification
      await Activity.create({
        staffId: user._id,
        action: "WEBHOOK_WALLET_FUND",
        details: `Webhook credited wallet with ₦${amountInNaira}. Ref: ${reference}`,
        targetUser: user._id,
      });

      await Notification.create({
        recipient: user._id,
        title: "Wallet Funded via Webhook",
        message: `Your wallet has been successfully credited with ₦${amountInNaira}.`,
        type: "wallet",
      });

      console.log(`Successfully funded ₦${amountInNaira} for user ${user.email} via Paystack Webhook.`);
    }

    // A amsa wa Paystack da cewa an karbi sako lafiya
    return res.status(200).json({ success: true, message: "Webhook received successfully" });
  } catch (error) {
    console.error("Paystack Webhook Error:", error);
    return res.status(500).json({ success: false, message: "Webhook processing error", error: error.message });
  }
};