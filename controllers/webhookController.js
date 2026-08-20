const crypto = require("crypto");
const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");

const MARKETPLACE_URL =
  process.env.MARKETPLACE_API_URL || "https://ayax-api-marketplace.onrender.com";

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

    if (event?.event === "charge.success") {
      const data = event.data;
      const { amount, reference, customer, authorization, dedicated_account_details } = data;
      const amountInNaira = Number(amount) / 100;
      const email = customer?.email?.toLowerCase().trim();

      const accountNumber =
        authorization?.receiver_bank_account_number ||
        dedicated_account_details?.account_number;

      // 2. Duba ko wannan user din na Data Xpress ne don sabunta balance
      let user = null;
      if (accountNumber) {
        user = await User.findOne({
          $or: [
            { accountNumber },
            { virtualAccountNumber: accountNumber },
            { "virtualAccount.accountNumber": accountNumber },
          ],
        });
      }

      if (!user && email) {
        user = await User.findOne({
          email: { $regex: new RegExp(`^${email}$`, "i") },
        });
      }

      if (user) {
        // Duba Idempotency (Kada a zuba sau biyu)
        const existingTx = await Transaction.findOne({ reference });
        if (!existingTx) {
          const updatedUser = await User.findByIdAndUpdate(
            user._id,
            { $inc: { walletBalance: amountInNaira, balance: amountInNaira } },
            { new: true }
          );

          await Transaction.create({
            user: user._id,
            transactionId: `DEP-${Date.now()}`,
            type: "wallet_funding",
            category: "wallet",
            amount: amountInNaira,
            status: "success",
            reference: reference,
            details: `Paystack Auto-Credit via Bank Transfer (Ref: ${reference})`,
          });

          console.log(`✅ [Data Xpress] Credited ${user.email} with ₦${amountInNaira}`);
        }
      }

      // 3. Tura kwafin bayanin zuwa Marketplace ta hanyar Data Xpress
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
            timeout: 30000,
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