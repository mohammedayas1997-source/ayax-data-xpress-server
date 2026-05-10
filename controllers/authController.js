const User = require("../models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const axios = require("axios");

// --- Helper: Generate and Send JWT Token ---
const sendToken = (user, statusCode, res) => {
  // Tabbatar JWT_SECRET yana nan
  if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET is missing!");
  }

  const token = jwt.sign(
    { id: user._id },
    process.env.JWT_SECRET || "fallback_secret",
    {
      expiresIn: "30d",
    },
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
    },
  });
};

// @desc    Register a new user
exports.register = async (req, res) => {
  try {
    const { name, email, phone, password, role, state, lga, address } =
      req.body;

    // 1. Duba ko user ya riga ya kasance
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res
        .status(400)
        .json({ success: false, message: "Email already registered" });
    }

    // 2. Kirkirar User
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

    // 3. MUHIMMI: Kira Paystack bayan an riga an halitta user
    // Muna sa shi a 'try-catch' daban don ko Paystack ya bada error, user din ya riga ya halitta
    try {
      await createDedicatedAccount(user);
    } catch (payError) {
      console.error("Paystack Account Creation Failed:", payError.message);
      // Kar mu dakatar da register saboda Paystack, za mu iya kirkiro account din daga baya
    }

    sendToken(user, 201, res);
  } catch (error) {
    console.error("Registration Error:", error.message);
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

    // Neman user da password dinsa
    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    // Gwada password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid credentials" });
    }

    sendToken(user, 200, res);
  } catch (error) {
    console.error("Login Error:", error.message);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

// @desc    Get current logged in user
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- Paystack Dedicated Account Logic ---
const createDedicatedAccount = async (user) => {
  try {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      console.log("Paystack Secret Key is missing in .env");
      return;
    }

    // A. Create Customer
    const customerResponse = await axios.post(
      "https://api.paystack.co/customer",
      {
        email: user.email,
        first_name: user.name.split(" ")[0] || "User",
        last_name: user.name.split(" ")[1] || "Ayax",
        phone: user.phone,
      },
      {
        headers: { Authorization: `Bearer ${secretKey}` },
      },
    );

    const customerCode = customerResponse.data.data.customer_code;

    // B. Create Dedicated Account
    const accountResponse = await axios.post(
      "https://api.paystack.co/dedicated_account",
      {
        customer: customerCode,
        preferred_bank: "wema-bank",
      },
      {
        headers: { Authorization: `Bearer ${secretKey}` },
      },
    );

    // C. Update User in DB
    await User.findByIdAndUpdate(user._id, {
      paystackCustomerCode: customerCode,
      bankName: accountResponse.data.data.bank.name,
      accountNumber: accountResponse.data.data.account_number,
      accountName: accountResponse.data.data.account_name,
    });

    console.log(`Dedicated account created for ${user.email}`);
  } catch (error) {
    // Kara duba error din daga Paystack
    const msg = error.response?.data?.message || error.message;
    console.log("Paystack API Error:", msg);
  }
};

// Placeholders for other routes
exports.forgotPassword = (req, res) =>
  res.status(501).json({ message: "Not implemented" });
exports.resetPassword = (req, res) =>
  res.status(501).json({ message: "Not implemented" });
exports.updatePassword = (req, res) =>
  res.status(501).json({ message: "Not implemented" });
exports.updatePin = (req, res) =>
  res.status(501).json({ message: "Not implemented" });
