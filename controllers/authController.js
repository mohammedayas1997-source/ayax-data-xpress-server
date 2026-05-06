const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const axios = require("axios");

// --- Helper: Generate and Send JWT Token ---
const sendToken = (user, statusCode, res) => {
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });

  res.status(statusCode).json({
    success: true,
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      balance: user.walletBalance,
      role: user.role,
    },
  });
};

// @desc    Register a new user
exports.register = async (req, res) => {
  try {
    const { name, email, phone, password, role, state, lga, address } =
      req.body;

    const user = await User.create({
      name,
      email,
      phone,
      password,
      role: role || "user",
      state: role === "agent" ? state : undefined,
      lga: role === "agent" ? lga : undefined,
      address: role === "agent" ? address : undefined,
    });

    // Create Paystack Dedicated Account (Background)
    createDedicatedAccount(user);

    sendToken(user, 201, res);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Authenticate user & get token
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Please provide email and password" });
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

// @desc    Get current logged in user (Sabo - Wannan kake nema a routes)
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- Password & Reset Placeholder (Don server ya tashi) ---
// Idan baka rubuta logic din su ba tukuna, bar su a haka don kar server ya bada error
exports.forgotPassword = async (req, res) => {
  res.status(500).json({ message: "Not implemented" });
};
exports.resetPassword = async (req, res) => {
  res.status(500).json({ message: "Not implemented" });
};
exports.updatePassword = async (req, res) => {
  res.status(500).json({ message: "Not implemented" });
};
exports.updatePin = async (req, res) => {
  res.status(500).json({ message: "Not implemented" });
};

// --- Paystack Dedicated Account Logic ---
const createDedicatedAccount = async (user) => {
  try {
    const customer = await axios.post(
      "https://api.paystack.co/customer",
      {
        email: user.email,
        first_name: user.name.split(" ")[0] || "User",
        last_name: user.name.split(" ")[1] || "Ayax",
        phone: user.phone,
      },
      {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      },
    );

    const account = await axios.post(
      "https://api.paystack.co/dedicated_account",
      {
        customer: customer.data.data.customer_code,
        preferred_bank: "wema-bank",
      },
      {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      },
    );

    await User.findByIdAndUpdate(user._id, {
      paystackCustomerCode: customer.data.data.customer_code,
      bankName: account.data.data.bank.name,
      accountNumber: account.data.data.account_number,
      accountName: account.data.data.account_name,
    });
  } catch (error) {
    console.log("Paystack Error:", error.message);
  }
};
