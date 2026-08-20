const crypto = require("crypto");
const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");

// Asalin Adireshin Backend na APIs Marketplace
const MARKETPLACE_BASE_URL =
  process.env.MARKETPLACE_API_URL || "https://ayax-api-marketplace.onrender.com";

/**
 * @desc    Paystack Webhook for automated background wallet funding (Unified for Data Xpress & APIs Marketplace)
 * @route   POST /api/v1/payment/webhook, POST /api/v1/webhooks/paystack
 * @access  Public (Called securely by Paystack Servers / Forwarded Requests)
 */
exports.handlePaystackWebhook = async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;
    const signature = req.headers["x-paystack-signature"];

    // 1. Security Check: Bada dama idan daga Paystack yake ko kuma internal forwarded ne
    if (signature === "internal_forwarded") {
      console.log("[Webhook Info] Received internally forwarded webhook from Marketplace.");
    } else if (secret && signature) {
      const payload = req.rawBody ? req.rawBody : JSON.stringify(req.body);
      const hash = crypto
        .createHmac("sha512", secret)
        .update(payload)
        .digest("hex");

      if (hash !== signature) {
        console.warn("[Webhook Warning] Invalid Paystack signature detected.");
        return res.status(401).send("Invalid Signature");
      }
    }

    const event = req.body;

    // 2. Duba idan an samu nasarar biya (charge.success)
    if (event && event.event === "charge.success") {
      const data = event.data;
      const { amount, reference, metadata, customer } = data;

      const customerCode = customer?.customer_code || null;
      const customerEmail = customer?.email ? customer.email.toLowerCase().trim() : null;
      let userId = metadata?.userId || null;
      const platform = metadata?.platform || null;

      const amountInNaira = Number(amount) / 100;

      // 3. Idan biyan na APIs Marketplace ne, tura zuwa https://ayax-api-marketplace.onrender.com
      if (platform === "ayax_marketplace") {
        console.log(`[Webhook Router] Transaction ${reference} belongs to Marketplace. Forwarding...`);
        const cleanMarketplaceUrl = MARKETPLACE_BASE_URL.replace(/\/+$/, "");

        try {
          await axios.post(
            `${cleanMarketplaceUrl}/api/v1/webhooks/paystack`,
            req.body,
            {
              headers: {
                "x-paystack-signature": "internal_forwarded",
                "Content-Type": "application/json",
              },
              timeout: 45000,
            }
          );
          console.log(`✅ [Webhook Router] Forwarded successfully to Marketplace (${cleanMarketplaceUrl}) for Ref: ${reference}`);
        } catch (fwdErr) {
          console.error(`❌ [Webhook Router] Marketplace forward error:`, fwdErr.response?.data || fwdErr.message);
        }
        return res.status(200).send("Marketplace forwarded");
      }

      // 4. RIGAKAFIN DOUBLE FUNDING (Idempotency check):
      if (Transaction) {
        const existingTx = await Transaction.findOne({ reference });
        if (existingTx) {
          console.log(`[Webhook Info] Transaction reference ${reference} already processed.`);
          return res.status(200).send("Transaction already processed");
        }
      }

      // 5. Virtual Account details (Dedicated NUBAN)
      const dedicatedAccount = data.dedicated_account_details || data.authorization;
      const accountNumber = dedicatedAccount?.account_number || dedicatedAccount?.receiver_bank_account_number;

      // 6. Nemo User a Data Xpress Database
      let user = null;

      if (userId) {
        user = await User.findById(userId);
      }

      if (!user && accountNumber) {
        user = await User.findOne({
          $or: [
            { virtualAccountNumber: accountNumber },
            { "virtualAccount.accountNumber": accountNumber },
            { accountNumber: accountNumber },
          ],
        });
      }

      if (!user && customerCode) {
        user = await User.findOne({
          $or: [
            { paystackCustomerCode: customerCode },
            { "virtualAccount.customerCode": customerCode },
            { customerCode: customerCode },
          ],
        });
      }

      if (!user && customerEmail) {
        user = await User.findOne({
          email: { $regex: new RegExp(`^${customerEmail}$`, "i") },
        });
      }

      if (!user) {
        console.warn(`[Webhook Warning] User not found for DVA transfer ref: ${reference}, email: ${customerEmail}, Account: ${accountNumber}`);
        return res.status(200).send("User not found in system");
      }

      // 7. Sabunta Wallet (Atomic & Safe Update ta amfani da $inc)
      const updatedUser = await User.findByIdAndUpdate(
        user._id,
        {
          $inc: {
            walletBalance: amountInNaira,
            balance: amountInNaira,
          },
        },
        { new: true }
      );

      const transactionId = `WWEB${Date.now()}${Math.floor(Math.random() * 1000)}`;

      // 8. Ajiye Record na Transaction
      if (Transaction) {
        await Transaction.create({
          user: user._id,
          userId: user._id,
          transactionId,
          type: "wallet_funding",
          category: "wallet",
          amount: amountInNaira,
          status: "success",
          reference: reference,
          details: `DVA / Paystack Auto-Funding (Ref: ${reference})`,
          balanceBefore: Number(user.walletBalance || user.balance || 0),
          balanceAfter: Number(updatedUser.walletBalance || updatedUser.balance || 0),
        });
      }

      // 9. Rubuta Activity Log
      if (Activity) {
        await Activity.create({
          staffId: user._id,
          action: "PAYSTACK_WEBHOOK_FUND",
          details: `Auto-funded wallet with ₦${amountInNaira} via Paystack DVA. Ref: ${reference}`,
          targetUser: user._id,
        });
      }

      // 10. Tura Sanarwa (Notification)
      if (Notification) {
        await Notification.create({
          recipient: user._id,
          title: "Wallet Credited",
          message: `Your wallet has been credited with ₦${amountInNaira} via Bank Transfer.`,
          type: "wallet",
        });
      }

      console.log(`✅ [AYAX DVA Webhook] Wallet successfully funded for: ${user.email} - ₦${amountInNaira}`);
    }

    return res.status(200).send("Webhook Received");
  } catch (error) {
    console.error("❌ Webhook Processing Error:", error);
    return res.status(200).send("Internal error but acknowledged");
  }
};