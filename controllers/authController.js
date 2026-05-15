const User = require("../models/User");
const jwt = require("jsonwebtoken");
const axios = require("axios");

// --- Helper: Generate Referral ID for Supervisors ---
const generateReferralId = (firstName, surname) => {
  const firstInitial = firstName ? firstName[0] : "A";
  const lastInitial = surname ? surname[0] : "X";
  const initials = (firstInitial + lastInitial).toUpperCase();
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `${initials}${digits}`;
};

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
      referralId: user.referralId,
      accountNumber: user.accountNumber,
      bankName: user.bankName,
      accountName: user.accountName,
    },
  });
};

// @desc    Register a new user with Automated Paystack Virtual Account
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

    // 1. Critical Validation
    if (!firstName || !surname || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message: "Registration failed: Mandatory data fields are missing.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const userExists = await User.findOne({
      $or: [{ email: normalizedEmail }, { phone: phone.trim() }],
    });

    if (userExists) {
      return res.status(400).json({
        success: false,
        message:
          "Identifier conflict: Email or phone string already exists in the database.",
      });
    }

    // 2. Automated Referral Logic
    let referralId = undefined;
    if (role === "supervisor" || role === "agent") {
      referralId = generateReferralId(firstName, surname);
    }

    // 3. Persistent Storage (Database Entry)
    const user = await User.create({
      firstName: firstName.trim(),
      surname: surname.trim(),
      name: `${firstName} ${surname}`.trim(),
      otherName: otherName ? otherName.trim() : "",
      email: normalizedEmail,
      phone: phone.trim(),
      password,
      role: role || "user",
      referralId,
      state,
      lga,
      address,
    });

    // 4. Paystack Virtual Account Provisioning
    try {
      const updatedUser = await createDedicatedAccount(user);
      return sendToken(updatedUser, 201, res);
    } catch (paystackError) {
      console.error(
        "Paystack Provisioning Failure:",
        paystackError.response?.data || paystackError.message,
      );
      // Return user without account details if Paystack API fails
      return sendToken(user, 201, res);
    }
  } catch (error) {
    console.error("Critical Registration Error:", error);
    res
      .status(500)
      .json({ success: false, message: "Internal server processing failure." });
  }
};

// --- Paystack Dedicated Account Logic (Internal Protocol) ---
const createDedicatedAccount = async (user) => {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey)
    throw new Error("Infrastructure Error: Paystack Secret Key undefined.");

  const axiosConfig = {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
  };

  // Step A: Create or Retrieve Paystack Customer Object
  const customerResponse = await axios.post(
    "https://api.paystack.co/customer",
    {
      email: user.email,
      first_name: user.firstName,
      last_name: user.surname,
      phone: user.phone,
    },
    axiosConfig,
  );

  const customerCode = customerResponse.data.data.customer_code;

  // Step B: Initialize Dedicated Virtual Account (Wema Bank Default)
  const accountResponse = await axios.post(
    "https://api.paystack.co/dedicated_account",
    {
      customer: customerCode,
      preferred_bank: "wema-bank",
    },
    axiosConfig,
  );

  const bankData = accountResponse.data.data;

  // Step C: Update User Record with Real-Time Banking Parameters
  return await User.findByIdAndUpdate(
    user._id,
    {
      paystackCustomerCode: customerCode,
      bankName: bankData.bank.name,
      accountNumber: bankData.account_number,
      accountName: bankData.account_name,
    },
    { new: true },
  );
};

// @desc    Authenticate user & session initialization
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Credentials required." });
    }

    const user = await User.findOne({
      email: email.toLowerCase().trim(),
    }).select("+password");
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({
        success: false,
        message: "Authentication failed: Invalid parameters.",
      });
    }

    sendToken(user, 200, res);
  } catch (error) {
    console.error("Login Protocol Error:", error);
    res
      .status(500)
      .json({ success: false, message: "Authentication server error." });
  }
};

// @desc    Paystack Webhook for Real-Time Wallet Funding
exports.paystackWebhook = async (req, res) => {
  try {
    const event = req.body;

    if (event.event === "charge.success") {
      const { customer, amount } = event.data;
      const creditValue = amount / 100; // Convert Kobo to Naira

      await User.findOneAndUpdate(
        { email: customer.email },
        { $inc: { walletBalance: creditValue } },
      );

      console.log(
        `[REAL-TIME FUNDING] Account ${customer.email} credited with NGN ${creditValue}`,
      );
    }

    res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("Webhook Synchronization Failure:", error.message);
    res.status(500).json({ status: "failed" });
  }
};

// Change Password Parameters
exports.updatePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user.id).select("+password");

  if (!(await user.matchPassword(currentPassword))) {
    return res.status(401).json({
      success: false,
      message: "Security check failed: Current key incorrect.",
    });
  }

  user.password = newPassword;
  await user.save();
  res
    .status(200)
    .json({ success: true, message: "Security parameters updated." });
};

// Update Transaction PIN Logic
exports.updatePin = async (req, res) => {
  const { newPin } = req.body;
  await User.findByIdAndUpdate(req.user.id, { transactionPin: newPin });
  res
    .status(200)
    .json({ success: true, message: "Transaction PIN synchronized." });
};
