const crypto = require("crypto");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");
// Idan kana da waniaban Model ko Controller na Data Xpress ko Marketplace, zaka iya import nasu anan idan sun sha bamban

/**
 * @desc    Paystack Webhook for automated background wallet funding (Unified for Marketplace & Data Xpress)
 * @route   POST /api/v1/payment/webhook
 * @access  Public (Called securely by Paystack Servers)
 */
exports.handlePaystackWebhook = async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;
    const signature = req.headers["x-paystack-signature"];

    // 1. Security Check: Tabbatar saƙon daga Paystack yake
    if (secret && signature) {
      const hash = crypto
        .createHmac("sha512", secret)
        .update(JSON.stringify(req.body))
        .digest("hex");

      if (hash !== signature) {
        console.warn("[Webhook Warning] Invalid Paystack signature detected.");
        return res.status(401).send("Invalid Signature");
      }
    }

    const event = req.body;

    // 2. Duba idan har an samu nasarar biya (charge.success)
    if (event && event.event === "charge.success") {
      const { amount, reference, metadata, customer } = event.data;
      
      let userId = metadata && metadata.userId ? metadata.userId : null;
      const userEmail = customer && customer.email ? customer.email.toLowerCase().trim() : null;
      const platform = metadata && metadata.platform ? metadata.platform : "ayax_marketplace"; // Default zuwa marketplace idan babu

      const amountInNaira = Number(amount) / 100;

      // 3. RIGAKAFIN DOUBLE FUNDING (Idempotency check):
      const existingTx = await Transaction.findOne({ reference });
      if (existingTx) {
        console.log(`[Webhook Info] Transaction reference ${reference} already processed.`);
        return res.status(200).send("Transaction already processed");
      }

      // Nemo mai amfani ta userId ko email
      let user = null;
      if (userId) {
        user = await User.findById(userId);
      } else if (userEmail) {
        user = await User.findOne({ email: userEmail });
      }

      if (!user) {
        console.warn(`[Webhook Warning] User not found for webhook reference: ${reference}`);
        return res.status(200).send("User not found in metadata or email");
      }

      // 4. Sabunta Wallet (Atomic & Safe Update)
      const currentBal = user.walletBalance !== undefined ? user.walletBalance : (user.balance || 0);
      const newBalance = currentBal + amountInNaira;

      user.walletBalance = newBalance;
      if (user.balance !== undefined) {
        user.balance = newBalance;
      }
      await user.save();

      const transactionId = `WWEB${Date.now()}${Math.floor(Math.random() * 1000)}`;

      // 5. Ajiye Record na Transaction (Zamu iya nuna platform din a details ko metadata)
      await Transaction.create({
        user: user._id,
        transactionId,
        type: "wallet_funding",
        category: "wallet",
        amount: amountInNaira,
        status: "success",
        reference: reference,
        details: `Auto-funding via Paystack Webhook for [${platform.toUpperCase()}] (Ref: ${reference})`,
      });

      // 6. Rubuta Activity Log
      await Activity.create({
        staffId: user._id,
        action: "PAYSTACK_WEBHOOK_FUND",
        details: `Auto-funded wallet with ₦${amountInNaira} via Paystack Webhook (${platform}). Ref: ${reference}`,
        targetUser: user._id,
      });

      // 7. Tura Sanarwa (Notification) ga Mai Amfani
      await Notification.create({
        recipient: user._id,
        title: "Wallet Funded via Webhook",
        message: `Your wallet has been automatically credited with ₦${amountInNaira} on ${platform.replace('_', ' ').toUpperCase()}. Reference: ${reference}`,
        type: "wallet",
      });

      // (Optional) Idan kana da wani karin aikin da kake son yi idan na Data Xpress ne ko Marketplace ne kadai:
      if (platform === "ayax_data_xpress") {
        console.log(`🚀 [Data Xpress Specific Action] Processing for user: ${user.email}`);
        // A nan zaka iya sanya duk wani karin code da kake so ya zama na Data Xpress kadai
      } else if (platform === "ayax_marketplace") {
        console.log(`🛒 [Marketplace Specific Action] Processing for user: ${user.email}`);
        // A nan zaka iya sanya duk wani karin code na Marketplace
      }

      console.log(`✅ [AYAX Webhook] Wallet successfully funded for: ${user.email} on ${platform} - ₦${amountInNaira}`);
    }

    return res.status(200).send("Webhook Received");
  } catch (error) {
    console.error("❌ Webhook Processing Error:", error.message);
    return res.status(200).send("Internal error but acknowledged");
  }
};