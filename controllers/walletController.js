const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const Notification = require("../models/Notification");
const axios = require("axios");
const crypto = require("crypto");

/**
 * @desc    Get current user's wallet balance
 * @route   GET /api/v1/wallet/balance
 * @access  Private
 */
exports.getBalance = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("walletBalance balance");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const currentBal = user.walletBalance !== undefined ? user.walletBalance : (user.balance || 0);

    res.status(200).json({
      success: true,
      balance: currentBal,
    });
  } catch (error) {
    console.error("Get Balance Error:", error);
    res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

/**
 * @desc    Generate or retrieve Paystack Dedicated Virtual Account
 * @route   POST /api/v1/wallet/generate-virtual-account
 * @access  Private
 */
exports.generateVirtualAccount = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.virtualAccount && user.virtualAccount.accountNumber) {
      return res.status(200).json({
        success: true,
        message: "Virtual account retrieved successfully",
        virtualAccount: user.virtualAccount,
      });
    }

    let customerCode = user.paystackCustomerCode;

    // 1. Kirkiri ko nemo customer a Paystack
    if (!customerCode) {
      try {
        const customerRes = await axios.post(
          "https://api.paystack.co/customer",
          {
            email: user.email.toLowerCase().trim(),
            first_name: user.firstName || user.name || "Ayax",
            last_name: user.lastName || "User",
            phone: user.phone || "08000000000",
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: 30000,
          }
        );
        customerCode = customerRes.data?.data?.customer_code;
      } catch (custError) {
        try {
          const fetchCust = await axios.get(
            `https://api.paystack.co/customer/${encodeURIComponent(user.email.toLowerCase().trim())}`,
            {
              headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
              },
            }
          );
          customerCode = fetchCust.data?.data?.customer_code;
        } catch (fetchErr) {
          console.error("Paystack Customer Fetch/Create Failed:", fetchErr.response?.data || fetchErr.message);
        }
      }

      if (customerCode) {
        user.paystackCustomerCode = customerCode;
        await user.save();
      }
    }

    // 2. Samar da Dedicated Virtual Account (Wema Bank)
    let dvaResponse;
    try {
      dvaResponse = await axios.post(
        "https://api.paystack.co/dedicated_account",
        {
          customer: customerCode || user.email.toLowerCase().trim(),
          preferred_bank: "wema-bank",
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        }
      );
    } catch (dvaError) {
      console.error("Paystack DVA Error:", dvaError.response?.data || dvaError.message);
      return res.status(502).json({
        success: false,
        message: dvaError.response?.data?.message || "Failed to generate virtual account from Paystack",
      });
    }

    const accountData = dvaResponse.data?.data;
    if (!accountData) {
      return res.status(502).json({ success: false, message: "Invalid response from Paystack DVA" });
    }

    // 3. Ajiye bayanan asusun
    user.virtualAccount = {
      bankName: accountData.bank ? accountData.bank.name : "Wema Bank",
      accountNumber: accountData.account_number,
      accountName: accountData.account_name,
      customerCode: customerCode,
    };
    user.virtualAccountNumber = accountData.account_number;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Virtual account generated successfully",
      virtualAccount: user.virtualAccount,
    });
  } catch (error) {
    console.error("Generate Virtual Account Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while generating virtual account",
      error: error.message,
    });
  }
};

/**
 * @desc    Initialize Paystack Payment (Card / Direct Deposit)
 * @route   POST /api/v1/wallet/initialize
 * @access  Private
 */
exports.initializePayment = async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!amount || Number(amount) < 100) {
      return res
        .status(400)
        .json({ success: false, message: "Minimum funding amount is ₦100" });
    }

    const amountInKobo = Math.round(Number(amount) * 100);

    let response;
    try {
      response = await axios.post(
        "https://api.paystack.co/transaction/initialize",
        {
          email: user.email,
          amount: amountInKobo,
          metadata: { userId: user._id.toString() },
          callback_url: `${process.env.FRONTEND_URL || "https://ayaxdata.online"}/wallet/verify`,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        },
      );
    } catch (paystackError) {
      console.error("Paystack Initialize Error:", paystackError.response?.data || paystackError.message);
      return res.status(502).json({
        success: false,
        message: paystackError.response?.data?.message || "Failed to initialize payment with Paystack",
      });
    }

    res.status(200).json({
      success: true,
      data: response.data.data,
    });
  } catch (error) {
    console.error("Initialize Payment Error:", error);
    res.status(500).json({
      success: false,
      message: "Payment initialization failed",
      error: error.message,
    });
  }
};

/**
 * @desc    Verify Paystack Payment and Fund Wallet
 * @route   GET /api/v1/wallet/verify/:reference
 * @access  Private
 */
exports.verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({ success: false, message: "Transaction reference is required" });
    }

    const alreadyProcessed = await Transaction.findOne({ reference, status: "success" });
    if (alreadyProcessed) {
      return res
        .status(200)
        .json({ success: true, message: "Transaction already processed", alreadyProcessed: true });
    }

    let response;
    try {
      response = await axios.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          },
          timeout: 30000,
        },
      );
    } catch (paystackError) {
      console.error("Paystack Verify Error:", paystackError.response?.data || paystackError.message);
      return res.status(502).json({
        success: false,
        message: "Failed to verify transaction with Paystack gateway",
      });
    }

    const txData = response.data.data;
    if (txData && txData.status === "success") {
      const amountInNaira = Number(txData.amount) / 100;
      const userId = txData.metadata && txData.metadata.userId ? txData.metadata.userId : req.user._id;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found for this transaction" });
      }

      const currentBal = user.walletBalance !== undefined ? user.walletBalance : (user.balance || 0);
      const newBalance = Number((currentBal + amountInNaira).toFixed(2));

      user.walletBalance = newBalance;
      if (user.balance !== undefined) {
        user.balance = newBalance;
      }
      await user.save();

      const transactionId = `DEP${Date.now()}${Math.floor(Math.random() * 1000)}`;
      await Transaction.findOneAndUpdate(
        { reference },
        {
          user: user._id,
          transactionId,
          type: "wallet_funding",
          category: "wallet",
          amount: amountInNaira,
          status: "success",
          reference: reference,
          details: `Wallet funding via Paystack App (Ref: ${reference})`,
        },
        { upsert: true, new: true }
      );

      await Activity.create({
        staffId: user._id,
        action: "VERIFY_PAYMENT_FUND",
        details: `Funded wallet with ₦${amountInNaira} via Paystack. Ref: ${reference}`,
        targetUser: user._id,
      });

      return res.status(200).json({
        success: true,
        message: "Wallet funded successfully!",
        balance: user.walletBalance,
      });
    } else {
      return res
        .status(400)
        .json({ success: false, message: "Payment was not successful or still pending" });
    }
  } catch (error) {
    console.error("Verification Error:", error);
    res.status(500).json({
      success: false,
      message: "Verification error",
      error: error.message,
    });
  }
};

/**
 * @desc    PAYSTACK LIVE WEBHOOK (Processes Bank Transfer & Card Payments automatically)
 * @route   POST /api/v1/wallet/paystack/webhook
 * @access  Public (Secured with Paystack HMAC SHA512 Signature)
 */
exports.paystackWebhook = async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      console.error("[WEBHOOK ERROR]: PAYSTACK_SECRET_KEY is missing in environment variables!");
      return res.sendStatus(500);
    }

    // 1. Tabbatar da Signature daga Paystack
    const signature = req.headers["x-paystack-signature"];
    const hash = crypto
      .createHmac("sha512", secret)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (hash !== signature) {
      console.warn("[WEBHOOK WARNING]: Invalid Paystack Signature received.");
      return res.status(400).send("Invalid signature");
    }

    const event = req.body;
    console.log(`[PAYSTACK WEBHOOK EVENT]: ${event.event}`);

    // 2. Duba idan biyan kudi ne ya yi nasara (charge.success ko dedicated_account.assign)
    if (event.event === "charge.success") {
      const data = event.data;
      const reference = data.reference;
      const amountInNaira = Number(data.amount) / 100;
      const customerEmail = data.customer?.email?.toLowerCase().trim();
      const customerCode = data.customer?.customer_code;
      const metaUserId = data.metadata?.userId;

      // Duba ko an riga an saka wannan kudin don gudun ninka balance (Idempotency)
      const existingTx = await Transaction.findOne({ reference, status: "success" });
      if (existingTx) {
        console.log(`[WEBHOOK]: Reference ${reference} already processed.`);
        return res.sendStatus(200);
      }

      // Nemo user ta metadata id, customer code, ko email
      let user = null;
      if (metaUserId) {
        user = await User.findById(metaUserId);
      }
      if (!user && customerCode) {
        user = await User.findOne({ paystackCustomerCode: customerCode });
      }
      if (!user && customerEmail) {
        user = await User.findOne({ email: customerEmail });
      }

      if (user) {
        const currentBal = user.walletBalance !== undefined ? user.walletBalance : (user.balance || 0);
        const newBalance = Number((currentBal + amountInNaira).toFixed(2));

        user.walletBalance = newBalance;
        if (user.balance !== undefined) {
          user.balance = newBalance;
        }
        await user.save();

        const transactionId = `DEP${Date.now()}${Math.floor(Math.random() * 1000)}`;

        await Transaction.findOneAndUpdate(
          { reference },
          {
            user: user._id,
            transactionId,
            type: "wallet_funding",
            category: "wallet",
            amount: amountInNaira,
            oldBalance: currentBal,
            newBalance: newBalance,
            status: "success",
            reference: reference,
            details: `Paystack Automated Deposit (₦${amountInNaira}) via ${data.channel || "Transfer/Card"}`,
          },
          { upsert: true, new: true }
        );

        await Activity.create({
          staffId: user._id,
          action: "PAYSTACK_WEBHOOK_CREDIT",
          details: `Credited ₦${amountInNaira} via Paystack Webhook. Ref: ${reference}`,
          targetUser: user._id,
        });

        console.log(`[WEBHOOK SUCCESS]: Credited ₦${amountInNaira} to user ${user.email}`);
      } else {
        console.error(`[WEBHOOK ERROR]: User not found for email: ${customerEmail}`);
      }
    }

    // Amsa wa Paystack nan take da 200 OK
    return res.sendStatus(200);
  } catch (error) {
    console.error("Paystack Webhook Handler Error:", error);
    return res.sendStatus(500);
  }
};

/**
 * @desc    Credit wallet manually (Testing / Admin Only)
 * @route   POST /api/v1/wallet/fund-manual
 * @access  Private/Admin
 */
exports.fundWalletManual = async (req, res) => {
  if (process.env.NODE_ENV === "production" && req.user.role !== "superadmin") {
    return res.status(403).json({ success: false, message: "Not allowed in production" });
  }
  try {
    const { amount } = req.body;
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: "Please provide a valid amount" });
    }

    const amountNum = Number(amount);
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const currentBal = user.walletBalance !== undefined ? user.walletBalance : (user.balance || 0);
    const newBalance = Number((currentBal + amountNum).toFixed(2));

    user.walletBalance = newBalance;
    if (user.balance !== undefined) {
      user.balance = newBalance;
    }
    await user.save();

    const transactionId = `MAN${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await Transaction.create({
      user: user._id,
      transactionId,
      type: "wallet_funding",
      category: "wallet",
      amount: amountNum,
      status: "success",
      reference: `MANUAL_${Date.now()}`,
      details: "Manual wallet credit (Testing / Admin)",
    });

    await Activity.create({
      staffId: user._id,
      action: "MANUAL_FUND_WALLET",
      details: `Manually credited wallet with ₦${amountNum}`,
      targetUser: user._id,
    });

    res.status(200).json({
      success: true,
      message: "Simulated funding successful",
      newBalance: user.walletBalance,
    });
  } catch (error) {
    console.error("Fund Wallet Manual Error:", error);
    res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};