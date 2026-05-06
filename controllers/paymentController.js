const User = require("../models/User");
const Transaction = require("../models/Transaction");
const crypto = require("crypto");

exports.paystackWebhook = async (req, res) => {
  try {
    // 1. Security Check: Tabbatar saƙon daga Paystack yake
    const hash = crypto
      .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      return res.status(401).send("Invalid signature");
    }

    const event = req.body;

    // 2. Duba idan tura kuɗi ne ya faru
    if (event.event === "charge.success") {
      const { amount, customer, reference } = event.data;
      const userEmail = customer.email;

      // Paystack na turo kudi a Kobo (raba da 100)
      const actualAmount = amount / 100;

      // 3. RIGAKAFIN DOUBLE FUNDING:
      // Duba idan har an riga an yi amfani da wannan reference din a baya
      const existingTransaction = await Transaction.findOne({ reference });
      if (existingTransaction) {
        return res.status(200).send("Transaction already processed");
      }

      // 4. Sabunta Wallet (Atomic Update)
      // Mun yi amfani da findOneAndUpdate don tabbatar da cewa ba a samu race condition ba
      const user = await User.findOneAndUpdate(
        { email: userEmail },
        { $inc: { walletBalance: actualAmount } }, // $inc yana kara kudin ne kai tsaye ba tare da save() ba
        { new: true },
      );

      if (user) {
        // 5. Ajiye Record na Transaction
        await Transaction.create({
          user: user._id,
          type: "wallet_funding",
          amount: actualAmount,
          status: "success",
          reference: reference,
          details: "Wallet funding via Paystack",
        });
      }
    }

    // 6. Sanar da Paystack cewa komai ya tafi lafiya
    res.status(200).send("Webhook received");
  } catch (error) {
    console.error("Webhook Error:", error.message);
    // Ko da kuskure ya faru, muna tura 200 don Paystack ya daina turo saƙon
    res.status(200).send("Error occurred but webhook acknowledged");
  }
};
// controllers/paymentController.js

exports.handlePaystackWebhook = async (req, res) => {
  try {
    // Paystack zai turo event a cikin req.body
    const event = req.body;
    console.log("Paystack Webhook Received:", event.event);

    // Nan gaba za ka sa koda ta biyan kudi (Funding Wallet)

    res.status(200).send("Webhook Received");
  } catch (error) {
    console.error("Webhook Error:", error.message);
    res.status(500).json({ message: "Webhook Error" });
  }
};
