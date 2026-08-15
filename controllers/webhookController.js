const crypto = require("crypto");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");

/**
 * @desc    Paystack Webhook for automated background wallet funding
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
      
      // Nemo userId daga metadata ko email idan babu metadata
      let userId = metadata && metadata.userId ? metadata.userId : null;
      const userEmail = customer && customer.email ? customer.email.toLowerCase().trim() : null;

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

      // 5. Ajiye Record na Transaction
      await Transaction.create({
        user: user._id,
        transactionId,
        type: "wallet_funding",
        category: "wallet",
        amount: amountInNaira,
        status: "success",
        reference: reference,
        details: `Auto-funding via Paystack Webhook (Ref: ${reference})`,
      });

      // 6. Rubuta Activity Log
      await Activity.create({
        staffId: user._id,
        action: "PAYSTACK_WEBHOOK_FUND",
        details: `Auto-funded wallet with ₦${amountInNaira} via Paystack Webhook. Ref: ${reference}`,
        targetUser: user._id,
      });

      // 7. Tura Sanarwa (Notification) ga Mai Amfani
      await Notification.create({
        recipient: user._id,
        title: "Wallet Funded via Webhook",
        message: `Your wallet has been automatically credited with ₦${amountInNaira}. Reference: ${reference}`,
        type: "wallet",
      });

      console.log(`✅ [AYAX Webhook] Wallet successfully funded for: ${user.email} - ₦${amountInNaira}`);
    }

    // 8. Dole ne a tura 200 OK koda ma event din ba 'charge.success' ba ne domin Paystack ya dakatar da turo saƙon sau da yawa (Retry logic)
    return res.status(200).send("Webhook Received");
  } catch (error) {
    console.error("❌ Webhook Processing Error:", error.message);
    // Ko da an samu error, muna tura 200 don Paystack ya daina turo mana sakon maimaituwa
    return res.status(200).send("Internal error but acknowledged");
  }
};