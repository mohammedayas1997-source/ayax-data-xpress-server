const User = require("../models/User");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const nodemailer = require("nodemailer");

// ===============================
// JWT TOKEN
// ===============================
const sendToken = (user, statusCode, res) => {
  const token = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "30d" },
  );

  return res.status(statusCode).json({
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

// ===============================
// EMAIL
// ===============================
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
      from: `"Ayax System" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: "Welcome",
      html: `<h2>Welcome ${user.firstName}</h2>`,
    });
  } catch (err) {
    console.log("Email error:", err.message);
  }
};

// ===============================
// REFERRAL ID
// ===============================
const generateReferralId = (firstName, surname) => {
  return (
    (firstName?.[0] || "A") +
    (surname?.[0] || "X") +
    Math.floor(1000 + Math.random() * 9000)
  ).toUpperCase();
};

// ===============================
// PAYSTACK ACCOUNT
// ===============================
const createDedicatedAccount = async (user) => {
  const config = {
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
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
};

// ===============================
// REGISTER
// ===============================
const register = async (req, res) => {
  try {
    const { firstName, surname, email, phone, password, role } = req.body;

    const cleanEmail = email.toLowerCase().trim();

    const exists = await User.findOne({
      $or: [{ email: cleanEmail }, { phone }],
    });

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "User already exists",
      });
    }

    const referralId =
      role === "agent" || role === "supervisor"
        ? generateReferralId(firstName, surname)
        : undefined;

    const user = await User.create({
      firstName,
      surname,
      name: `${firstName} ${surname}`,
      email: cleanEmail,
      phone,
      password,
      role: role || "user",
      referralId,
    });

    try {
      const updated = await createDedicatedAccount(user);
      sendWelcomeEmail(updated);
      return sendToken(updated, 201, res);
    } catch (err) {
      const fallback = await User.findById(user._id);
      sendWelcomeEmail(fallback);
      return sendToken(fallback, 201, res);
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ===============================
// LOGIN (ALL USERS)
// ===============================
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

    const ok = await user.matchPassword(password);

    if (!ok) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    return sendToken(user, 200, res);
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ===============================
// SUPERVISOR LOGIN
// ===============================
const supervisorLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

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

    const ok = await user.matchPassword(password);

    if (!ok) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    return sendToken(user, 200, res);
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ===============================
// PAYSTACK WEBHOOK
// ===============================
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
    res.status(500).json({ success: false });
  }
};

// ===============================
// EXPORT (IMPORTANT FIX)
// ===============================
module.exports = {
  register,
  login,
  supervisorLogin,
  paystackWebhook,
};
