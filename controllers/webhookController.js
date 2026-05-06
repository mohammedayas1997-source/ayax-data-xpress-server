const crypto = require("crypto");
const User = require("../models/User");
const Transaction = require("../models/Transaction");

exports.handlePaystackWebhook = async (req, res) => {
  try {
    // 1. Validation: Tabbatar saƙon daga Paystack yake
    const secret =
      process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;
    const hash = crypto
      .createHmac("sha512", secret)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== req.headers["x-paystack-signature"]) {
      return res.status(401).send("Invalid Signature");
    }

    const event = req.body;

    // 2. Duba idan har an samu nasarar biya
    if (event.event === "charge.success") {
      const { amount, reference, metadata } = event.data;
      const userId = metadata?.userId; // Metadata ne ke dauke da ID din user

      if (!userId) {
        return res.status(200).send("No userId in metadata");
      }

      const amountInNaira = amount / 100;

      // 3. Duba idan ba mu riga mun saka kudin ba (Idempotency check)
      const existingTx = await Transaction.findOne({ reference: reference });

      if (!existingTx) {
        // ATOMIC UPDATE: Mun yi amfani da $inc don kare race condition
        const user = await User.findByIdAndUpdate(
          userId,
          { $inc: { walletBalance: amountInNaira } },
          { new: true },
        );

        if (user) {
          await Transaction.create({
            user: userId,
            type: "deposit",
            amount: amountInNaira,
            status: "success",
            reference: reference,
            details: "Auto-funding via Paystack Webhook",
          });
          console.log(`[AYAX] Wallet funded for: ${user.email}`);
        }
      }
    }

    // 4. Dole ne ka tura 200 OK koda ma event din ba 'charge.success' ba ne
    res.status(200).send("Webhook Received");
  } catch (error) {
    console.error("Webhook Error:", error.message);
    // Ko da an samu error, muna tura 200 don Paystack ya daina turo mana sakon (Retry logic)
    res.status(200).send("Internal error but acknowledged");
  }
};
