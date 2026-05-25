const User = require("../models/User");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const nodemailer = require("nodemailer");

// ================================
// HELPERS
// ================================

const generateReferralId = (firstName, surname) => {
  const firstInitial = firstName ? firstName[0] : "A";
  const lastInitial = surname ? surname[0] : "X";
  return `${(firstInitial + lastInitial).toUpperCase()}${Math.floor(
    1000 + Math.random() * 9000,
  )}`;
};

// ================================
// EMAIL SYSTEM
// ================================

const sendWelcomeEmail = async (user) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Ayax Data Xpress" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: "Welcome to Ayax Data Xpress",
      html: `<h2>Welcome ${user.firstName}</h2>`,
    });
  } catch (err) {
    console.log("Email error:", err.message);
  }
};

// ================================
// JWT
// ================================

const sendToken = (user, statusCode, res) => {
  const token = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "30d" },
  );

  res.status(statusCode).json({
    success: true,
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      walletBalance: user.walletBalance,
    },
  });
};

// ================================
// PAYSTACK ACCOUNT CREATION
// ================================

const createDedicatedAccount = async (user) => {
  try {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;

    const config = {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    };

    const customer = await axios.post(
      "https://api.paystack.co/customer",
      {
        email: user.email,
        first_name: user.firstName,
        last_name: user.surname,
        phone: user.phone,
      },
      config,
    );

    const customerCode = customer.data.data.customer_code;

    const account = await axios.post(
      "https://api.paystack.co/dedicated_account",
      {
        customer: customerCode,
        preferred_bank: "wema-bank",
      },
      config,
    );

    const data = account.data.data;

    return await User.findByIdAndUpdate(
      user._id,
      {
        paystackCustomerCode: customerCode,
        bankName: data.bank.name,
        accountNumber: data.account_number,
        accountName: data.account_name,
      },
      { new: true },
    );
  } catch (error) {
    throw error;
  }
};

// ================================
// REGISTER
// ================================

const register = async (req, res) => {
  try {
    const {
      firstName,
      surname,
      email,
      phone,
      password,
      role,
      state,
      lga,
      address,
    } = req.body;

    const emailCheck = email.toLowerCase().trim();

    const exists = await User.findOne({
      $or: [{ email: emailCheck }, { phone }],
    });

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "User already exists",
      });
    }

    const referralId =
      role === "supervisor" || role === "agent"
        ? generateReferralId(firstName, surname)
        : undefined;

    const user = await User.create({
      firstName,
      surname,
      name: `${firstName} ${surname}`,
      email: emailCheck,
      phone,
      password,
      role,
      referralId,
      state,
      lga,
      address,
    });

    try {
      const updated = await createDedicatedAccount(user);
      sendWelcomeEmail(updated);
      return sendToken(updated, 201, res);
    } catch (err) {
      console.log("Paystack error:", err.message);

      const fallback = await User.findByIdAndUpdate(
        user._id,
        {
          bankName: "Wema Bank",
          accountNumber: "Pending",
          accountName: user.name,
        },
        { new: true },
      );

      sendWelcomeEmail(fallback);
      return sendToken(fallback, 201, res);
    }
  } catch (error) {
    console.log("REGISTER ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ================================
// LOGIN
// ================================

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({
      email: email.toLowerCase().trim(),
    }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const match = await user.matchPassword(password);

    if (!match) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    return sendToken(user, 200, res);
  } catch (error) {
    console.log("LOGIN ERROR:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ================================
// SUPERVISOR LOGIN
// ================================

const supervisorLogin = async (req, res) => {
  try {
    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      role: "supervisor",
    }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const match = await user.matchPassword(password);

    if (!match) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    return sendToken(user, 200, res);
  } catch (error) {
    console.log("SUPERVISOR LOGIN ERROR:", error);
    res.status(500).json({ success: false });
  }
};

// ================================
// WEBHOOK
// ================================

const paystackWebhook = async (req, res) => {
  try {
    const event = req.body;

    if (event.event === "charge.success") {
      const email = event.data.customer.email;
      const amount = event.data.amount / 100;

      await User.findOneAndUpdate(
        { email },
        { $inc: { walletBalance: amount } },
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false });
  }
};

// ================================
// UPDATE PASSWORD
// ================================

const updatePassword = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("+password");

    const match = await user.matchPassword(req.body.currentPassword);

    if (!match) {
      return res.status(401).json({
        success: false,
        message: "Wrong password",
      });
    }

    user.password = req.body.newPassword;
    await user.save();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
};

// ================================
// UPDATE PIN
// ================================

const updatePin = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, {
      pin: req.body.newPin,
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
};

// ================================
// EXPORT (FIXED - NO OVERWRITE)
// ================================

module.exports = {
  register,
  login,
  supervisorLogin,
  paystackWebhook,
  updatePassword,
  updatePin,
};
