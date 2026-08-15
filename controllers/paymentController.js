const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");
const crypto = require("crypto");

/**
 * @desc    Paystack Webhook for automated wallet funding
 * @route   POST /api/v1/payment/webhook
 * @access  Public (Called by Paystack Servers)
 */
exports.paystackWebhook = async (req, res) => {
  try {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    const signature = req.headers["x-paystack-signature"];

    // 1. Security Check: Tabbatar saƙon daga Paystack yake (idan akwai secret key)
    if (secretKey && signature) {
      const hash = crypto
        .createHmac("sha512", secretKey)
        .update(JSON.stringify(req.body))
        .digest("hex");

      if (hash !== signature) {
        console.warn("[Webhook Warning] Invalid Paystack signature detected.");
        return res.status(401).send("Invalid signature");
      }
    }

    const event = req.body;

    // 2. Duba idan tura kuɗi ne ya faru (charge.success)
    if (event && event.event === "charge.success") {
      const { amount, customer, reference } = event.data;
      const userEmail = customer && customer.email ? customer.email.toLowerCase().trim() : null;

      if (!userEmail) {
        console.error("[Webhook Error] Customer email missing in Paystack payload.");
        return res.status(200).send("Customer email missing");
      }

      // Paystack na turo kudi a Kobo (raba da 100 don samun Naira)
      const actualAmount = Number(amount) / 100;

      // 3. RIGAKAFIN DOUBLE FUNDING:
      // Duba idan har an riga an yi amfani da wannan reference din a baya
      const existingTransaction = await Transaction.findOne({ reference });
      if (existingTransaction) {
        console.log(`[Webhook Info] Transaction reference ${reference} already processed.`);
        return res.status(200).send("Transaction already processed");
      }

      // 4. Nemo mai amfani sannan a sabunta Wallet daidai da kowane tsari
      const user = await User.findOne({ email: userEmail });
      if (!user) {
        console.warn(`[Webhook Warning] User with email ${userEmail} not found in database.`);
        return res.status(200).send("User not found");
      }

      const currentBal = user.walletBalance !== undefined ? user.walletBalance : (user.balance || 0);
      const newBalance = currentBal + actualAmount;

      user.walletBalance = newBalance;
      if (user.balance !== undefined) {
        user.balance = newBalance;
      }
      await user.save();

      const transactionId = `PAY${Date.now()}${Math.floor(Math.random() * 1000)}`;

      // 5. Ajiye Record na Transaction a Transaction Model da kuma User array idan akwai
      await Transaction.create({
        user: user._id,
        transactionId,
        type: "wallet_funding",
        amount: actualAmount,
        status: "success",
        reference: reference,
        details: `Wallet funding via Paystack (Ref: ${reference})`,
      });

      if (!user.transactions) user.transactions = [];
      user.transactions.push({
        transactionId,
        type: "credit",
        amount: actualAmount,
        status: "success",
        description: `Wallet funding via Paystack`,
        date: new Date(),
      });
      await user.save();

      // 6. Rubuta Activity Log
      await Activity.create({
        staffId: user._id,
        action: "WALLET_FUNDED_WEBHOOK",
        details: `Successfully funded wallet with ₦${actualAmount} via Paystack. Ref: ${reference}`,
        targetUser: user._id,
      });

      // 7. Tura Sanarwa (Notification) ga Mai Amfani
      await Notification.create({
        recipient: user._id,
        title: "Wallet Funded Successfully",
        message: `Your wallet has been credited with ₦${actualAmount}. Reference: ${reference}`,
        type: "wallet",
      });

      console.log(`✅ [Webhook Success] Wallet funded: ${userEmail} - ₦${actualAmount}`);
    }

    // 8. Sanar da Paystack cewa komai ya tafi lafiya
    return res.status(200).send("Webhook received");
  } catch (error) {
    console.error("❌ Webhook Processing Error:", error.message);
    // Ko da kuskure ya faru, ana tura 200 don Paystack ya daina maimaita turo saƙon (retry)
    return res.status(200).send("Error occurred but webhook acknowledged");
  }
};