const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
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
      referralId: user.referralId, // Included for Supervisor Dashboard access
      accountNumber: user.accountNumber,
      bankName: user.bankName,
      accountName: user.accountName,
    },
  });
};

// @desc    Register a new user with Automatic Paystack Wallet & Supervisor ID
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

    // 1. Validation check
    if (!firstName || !surname || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message:
          "Mandatory fields: firstName, surname, email, phone, and password are required.",
      });
    }

    const userExists = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { phone: phone }],
    });

    if (userExists) {
      return res.status(400).json({
        success: false,
        message: "User with this email or phone already exists",
      });
    }

    // --- Automatic Referral ID Logic ---
    let referralId = undefined;
    if (role === "supervisor") {
      referralId = generateReferralId(firstName, surname);
    }

    // 2. Create User in Database
    const user = await User.create({
      firstName,
      surname,
      name: `${firstName} ${surname}`.trim(),
      otherName,
      email: email.toLowerCase(),
      phone,
      password,
      role: role || "user",
      referralId: referralId, // Assigned automatically if role is supervisor
      state: state,
      lga: lga,
      address: address,
    });

    // 3. Trigger Paystack Dedicated Account Creation
    try {
      const updatedUser = await createDedicatedAccount(user);
      sendToken(updatedUser, 201, res);
    } catch (payError) {
      console.error(
        "Paystack Account Creation Failed:",
        payError.response?.data || payError.message,
      );
      sendToken(user, 201, res);
    }
  } catch (error) {
    console.error("Registration Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- Paystack Dedicated Account Logic (PRIVATE) ---
const createDedicatedAccount = async (user) => {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) throw new Error("Paystack Secret Key is missing in .env");

  const customerResponse = await axios.post(
    "https://api.paystack.co/customer",
    {
      email: user.email,
      first_name: user.firstName,
      last_name: user.surname,
      phone: user.phone,
    },
    {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    },
  );

  const customerCode = customerResponse.data.data.customer_code;

  const accountResponse = await axios.post(
    "https://api.paystack.co/dedicated_account",
    {
      customer: customerCode,
      preferred_bank: "wema-bank",
    },
    {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    },
  );

  const bankData = accountResponse.data.data;
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

// @desc    Authenticate user & get token
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Provide email and password" });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+password",
    );

    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    sendToken(user, 200, res);
  } catch (error) {
    console.error("Login Error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server Error during login" });
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
    const event = req.body;

    if (event.event === "charge.success") {
      const { customer, amount, reference } = event.data;
      const actualAmount = amount / 100;

      const user = await User.findOneAndUpdate(
        { email: customer.email },
        { $inc: { walletBalance: actualAmount } },
        { new: true },
      );

      console.log(
        `[Webhook Success] Credited ${customer.email} with N${actualAmount}`,
      );
    }

    res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("Webhook Error:", error.message);
    res.status(500).json({ status: "failed" });
  }
};

// Change Password
exports.updatePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user.id).select("+password");

  if (!(await user.matchPassword(currentPassword))) {
    return res
      .status(401)
      .json({ success: false, message: "Current password incorrect" });
  }

  user.password = newPassword;
  await user.save();
  res
    .status(200)
    .json({ success: true, message: "Password updated successfully" });
};

// Update Transaction PIN
exports.updatePin = async (req, res) => {
  const { newPin } = req.body;
  await User.findByIdAndUpdate(req.user.id, { transactionPin: newPin });
  res.status(200).json({ success: true, message: "PIN updated successfully" });
};
