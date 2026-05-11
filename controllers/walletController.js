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

// --- GYARA A NAN: Na kara 'exports.' a gaba ---
exports.generateVirtualAccount = async (req, res) => {
  try {
    // Nemo user daga database don tabbatar muna da latest data
    const user = await User.findById(req.user._id);

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // 1. Fara kirkirar Customer a Paystack idan bashi da customer_code
    // Na gyara phoneNumber zuwa phone (kamar yadda yake a Schema dinka)
    const customerResponse = await axios.post(
      "https://api.paystack.co/customer",
      {
        email: user.email,
        first_name: user.firstName,
        last_name: user.surname, // Amfani da surname kamar yadda yake a Schema
        phone: user.phone,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    const customerCode = customerResponse.data.data.customer_code;

    // 2. Samar da Dedicated Account
    const accountResponse = await axios.post(
      "https://api.paystack.co/dedicated_account",
      {
        customer: customerCode,
        preferred_bank: "wema-bank",
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (accountResponse.data.status) {
      // 3. Ajiye bayanan account din a Database
      const bankData = accountResponse.data.data;

      user.paystackCustomerCode = customerCode;
      user.accountNumber = bankData.account_number;
      user.bankName = bankData.bank.name;
      user.accountName = bankData.account_name;

      await user.save();

      return res.status(200).json({
        success: true,
        message: "Virtual account generated successfully",
        data: {
          accountNumber: user.accountNumber,
          bankName: user.bankName,
          accountName: user.accountName,
        },
      });
    }
  } catch (error) {
    console.error("Paystack Error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || "Failed to generate account",
    });
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
        callback_url: `${process.env.FRONTEND_URL}/wallet/verify`,
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

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $inc: { walletBalance: amountInNaira } },
        { new: true },
      );

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
