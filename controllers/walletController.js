const User = require("../models/User");
const Transaction = require("../models/Transaction");
const axios = require("axios");

// @desc    Get current user's wallet balance
exports.getBalance = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("walletBalance");
    res.status(200).json({
      success: true,
      balance: user.walletBalance || 0,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

// @desc    Initialize Paystack Payment
exports.initializePayment = async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await User.findById(req.user._id);

    if (!amount || amount < 100) {
      return res
        .status(400)
        .json({ success: false, message: "Minimum funding amount is N100" });
    }

    const amountInKobo = Math.round(Number(amount) * 100);

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email: user.email,
        amount: amountInKobo,
        metadata: { userId: user._id },
        callback_url: `${process.env.FRONTEND_URL}/wallet/verify`, // Tabbatar ka saka wannan a .env
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    res.status(200).json({
      success: true,
      data: response.data.data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Payment initialization failed",
      error: error.message,
    });
  }
};

// @desc    Verify Paystack Payment and Fund Wallet
exports.verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;

    // 1. RIGAKAFIN DOUBLE FUNDING
    // Duba idan an riga an yi amfani da wannan reference din a Transaction model
    const alreadyProcessed = await Transaction.findOne({ reference });
    if (alreadyProcessed) {
      return res
        .status(400)
        .json({ success: false, message: "Transaction already processed" });
    }

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      },
    );

    if (response.data.data.status === "success") {
      const amountInNaira = response.data.data.amount / 100;
      const userId = response.data.data.metadata.userId;

      // 2. ATOMIC UPDATE: Kara kudi ba tare da hadarin race condition ba
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $inc: { walletBalance: amountInNaira } },
        { new: true },
      );

      // 3. Record Transaction
      await Transaction.create({
        user: userId,
        type: "deposit",
        amount: amountInNaira,
        status: "success",
        reference: reference,
        details: "Wallet funding via Paystack App",
      });

      res.status(200).json({
        success: true,
        message: "Wallet funded successfully!",
        balance: updatedUser.walletBalance,
      });
    } else {
      res
        .status(400)
        .json({ success: false, message: "Payment not successful" });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Verification error",
      error: error.message,
    });
  }
};

// @desc    Credit wallet (Testing Only)
exports.fundWalletManual = async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ message: "Not allowed in production" });
  }
  try {
    const { amount } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { walletBalance: Number(amount) } },
      { new: true },
    );

    res.status(200).json({
      success: true,
      message: `Simulated funding successful`,
      newBalance: user.walletBalance,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server Error" });
  }
};
