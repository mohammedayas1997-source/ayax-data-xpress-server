const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const axios = require("axios");

// --- Helper: Generate and Send JWT Token ---
const sendToken = (user, statusCode, res) => {
  const token = jwt.sign(
    { id: user._id },
    process.env.JWT_SECRET || "fallback_secret",
    { expiresIn: "30d" },
  );

  res.status(statusCode).json({
    success: true,
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      balance: user.walletBalance || 0,
      role: user.role,
      accountNumber: user.accountNumber,
      bankName: user.bankName,
      accountName: user.accountName,
    },
  });
};

// @desc    Register a new user with Automatic Paystack Wallet
exports.register = async (req, res) => {
  try {
    const {
      firstName,
      surname,
      otherName,
      email,
      phone,
      password,
      role,
      state,
      lga,
      address,
    } = req.body;

    if (!firstName || !surname || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message:
          "Mandatory fields: firstName, surname, email, phone, and password are required.",
      });
    }

    const fullName = `${firstName} ${surname}`.trim();

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res
        .status(400)
        .json({ success: false, message: "Email already registered" });
    }

    // 1. Create User in Database
    const user = await User.create({
      firstName,
      surname,
      name: fullName,
      otherName,
      email,
      phone,
      password,
      role: role || "user",
      state: role === "agent" ? state : undefined,
      lga: role === "agent" ? lga : undefined,
      address: role === "agent" ? address : undefined,
    });

    // 2. Trigger Paystack Dedicated Account Creation
    try {
      const updatedUser = await createDedicatedAccount(user);
      // Return token with updated user details (including account numbers)
      sendToken(updatedUser, 201, res);
    } catch (payError) {
      console.error("Paystack Account Creation Failed:", payError.message);
      // Still send token even if Paystack fails (User can generate it later in profile)
      sendToken(user, 201, res);
    }
  } catch (error) {
    console.error("Registration Error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// --- Paystack Dedicated Account Logic (PRIVATE) ---
const createDedicatedAccount = async (user) => {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) throw new Error("Paystack Secret Key is missing");

  // Step A: Create or Get Customer on Paystack
  const customerResponse = await axios.post(
    "https://api.paystack.co/customer",
    {
      email: user.email,
      first_name: user.firstName,
      last_name: user.surname,
      phone: user.phone,
    },
    { headers: { Authorization: `Bearer ${secretKey}` } },
  );

  const customerCode = customerResponse.data.data.customer_code;

  // Step B: Request Dedicated Virtual Account
  const accountResponse = await axios.post(
    "https://api.paystack.co/dedicated_account",
    {
      customer: customerCode,
      preferred_bank: "wema-bank",
    },
    { headers: { Authorization: `Bearer ${secretKey}` } },
  );

  // Step C: Save to User Record and Return Updated User
  const bankData = accountResponse.data.data;
  const finalizedUser = await User.findByIdAndUpdate(
    user._id,
    {
      paystackCustomerCode: customerCode,
      bankName: bankData.bank.name,
      accountNumber: bankData.account_number,
      accountName: bankData.account_name,
    },
    { new: true }, // Returns the updated document
  );

  return finalizedUser;
};

// @desc    Authenticate user & get token
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Provide email and password" });
    }

    const user = await User.findOne({ email }).select("+password");

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    sendToken(user, 200, res);
  } catch (error) {
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

// @desc    Get current user profile
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Paystack Webhook for Automated Funding
exports.paystackWebhook = async (req, res) => {
  try {
    // Note: In production, verify Paystack signature here for security
    const event = req.body;

    if (event.event === "charge.success") {
      const { customer, amount, fees } = event.data;
      const actualAmount = (amount - (fees || 0)) / 100; // Deduct fees if you want user to bear them

      await User.findOneAndUpdate(
        { email: customer.email },
        { $inc: { walletBalance: actualAmount } },
      );

      console.log(
        `[Webhook] Success: ${actualAmount} added to ${customer.email}`,
      );
    }

    res.status(200).send("Webhook Received");
  } catch (error) {
    console.error("Webhook Error:", error.message);
    res.status(500).send("Webhook Error");
  }
};

// Placeholders
exports.forgotPassword = (req, res) =>
  res.status(501).json({ message: "Not implemented" });
exports.resetPassword = (req, res) =>
  res.status(501).json({ message: "Not implemented" });
exports.updatePassword = (req, res) =>
  res.status(501).json({ message: "Not implemented" });
exports.updatePin = (req, res) =>
  res.status(501).json({ message: "Not implemented" });
