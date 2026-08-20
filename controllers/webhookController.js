const crypto = require("crypto");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");

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
      // Tabbatar da amfani da rawBody idan akwai, ko fallback
      const payload = req.rawBody ? req.rawBody : JSON.stringify(req.body);
      const hash = crypto
        .createHmac("sha512", secret)
        .update(payload)
        .digest("hex");

      if (hash !== signature) {
        console.warn("[Webhook Warning] Invalid Paystack signature detected.");
        // Idan kuna testing zaku iya log din wannan, amma a production idan ya gaza duba rawBody middleware
        return res.status(401).send("Invalid Signature");
      }
    }

    const event = req.body;

    // 2. Duba idan har an samu nasarar biya (charge.success)
    if (event && event.event === "charge.success") {
      const data = event.data;
      const { amount, reference, metadata, customer } = data;

      const customerCode = customer && customer.customer_code ? customer.customer_code : null;
      const customerEmail = customer && customer.email ? customer.email.toLowerCase().trim() : null;
      let userId = metadata && metadata.userId ? metadata.userId : null;
      const platform = metadata && metadata.platform ? metadata.platform : "ayax_data_xpress";

      // 3. Virtual Account details (Dedicated NUBAN)
      const dedicatedAccount = data.dedicated_account_details || data.authorization;
      const accountNumber = dedicatedAccount?.account_number || dedicatedAccount?.receiver_bank_account_number;

      const amountInNaira = Number(amount) / 100;

      // 4. RIGAKAFIN DOUBLE FUNDING (Idempotency check):
      const existingTx = await Transaction.findOne({ reference });
      if (existingTx) {
        console.log(`[Webhook Info] Transaction reference ${reference} already processed.`);
        return res.status(200).send("Transaction already processed");
      }

      // 5. Nemo mai amfani ta kowace hanya (UserId, Customer Code, Account Number, ko Email)
      let user = null;

      if (userId) {
        user = await User.findById(userId);
      }
      
      if (!user && customerCode) {
        user = await User.findOne({
          $or: [
            { paystackCustomerCode: customerCode },
            { "virtualAccount.customerCode": customerCode },
            { customerCode: customerCode }
          ]
        });
      }

      if (!user && accountNumber) {
        user = await User.findOne({
          $or: [
            { virtualAccountNumber: accountNumber },
            { "virtualAccount.accountNumber": accountNumber },
            { accountNumber: accountNumber }
          ]
        });
      }

      if (!user && customerEmail) {
        user = await User.findOne({ 
          email: { $regex: new RegExp(`^${customerEmail}$`, "i") } 
        });
      }

      if (!user) {
        console.warn(`[Webhook Warning] User not found for DVA transfer ref: ${reference}, email: ${customerEmail}, customerCode: ${customerCode}`);
        // A mayar da 200 ga Paystack don kada su ci gaba da maimaita turo saƙon
        return res.status(200).send("User not found in system");
      }

      // 6. Sabunta Wallet (Atomic & Safe Update ta amfani da $inc don gujewa race condition)
      const updatedUser = await User.findByIdAndUpdate(
        user._id,
        {
          $inc: {
            walletBalance: amountInNaira,
            balance: amountInNaira
          }
        },
        { new: true }
      );

      const transactionId = `WWEB${Date.now()}${Math.floor(Math.random() * 1000)}`;

      // 7. Ajiye Record na Transaction
      await Transaction.create({
        user: user._id,
        transactionId,
        type: "wallet_funding",
        category: "wallet",
        amount: amountInNaira,
        status: "success",
        reference: reference,
        details: `DVA / Paystack Auto-Funding (Ref: ${reference})`,
      });

      // 8. Rubuta Activity Log
      await Activity.create({
        staffId: user._id,
        action: "PAYSTACK_WEBHOOK_FUND",
        details: `Auto-funded wallet with ₦${amountInNaira} via Paystack DVA. Ref: ${reference}`,
        targetUser: user._id,
      });

      // 9. Tura Sanarwa (Notification)
      await Notification.create({
        recipient: user._id,
        title: "Wallet Credited",
        message: `Your wallet has been credited with ₦${amountInNaira} via Bank Transfer.`,
        type: "wallet",
      });

      console.log(`✅ [AYAX DVA Webhook] Wallet successfully funded for: ${user.email} - ₦${amountInNaira}`);
    }

    return res.status(200).send("Webhook Received");
  } catch (error) {
    console.error("❌ Webhook Processing Error:", error);
    return res.status(200).send("Internal error but acknowledged");
  }
};