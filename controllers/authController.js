const User = require("../models/User");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");

// ================================
// HELPERS
// ================================

const generateReferralId = (firstName = "A", surname = "X") => {
  return `${firstName[0]}${surname[0]}${Math.floor(
    1000 + Math.random() * 9000,
  )}`.toUpperCase();
};

// ================================
// EMAIL
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
      from: `"Ayax System" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: "Welcome",
      html: `<h2>Welcome ${user.firstName}</h2>`,
    });
  } catch (err) {
    console.log("Email error:", err.message);
  }
};

// ================================
// TOKEN
// ================================

const sendToken = (user, res) => {
  const token = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET || "secret",
    { expiresIn: "30d" },
  );

  res.status(200).json({
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
// REGISTER
// ================================

const register = async (req, res) => {
  try {
    const { firstName, surname, email, phone, password, role } = req.body;

    if (!email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message: "Missing fields",
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    const exists = await User.findOne({ email: cleanEmail });

    if (exists) {
      return res.status(400).json({
        success: false,
        message: "User exists already",
      });
    }

    const user = await User.create({
      firstName,
      surname,
      name: `${firstName} ${surname}`,
      email: cleanEmail,
      phone,
      password,
      role: role || "user",
      referralId:
        role === "agent" || role === "supervisor"
          ? generateReferralId(firstName, surname)
          : undefined,
    });

    sendWelcomeEmail(user);
    return sendToken(user, res);
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ================================
// LOGIN (SAFE FIXED)
// ================================

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({
      email: email?.toLowerCase().trim(),
    }).select("+password");

    if (!user || !user.password) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    return sendToken(user, res);
  } catch (err) {
    console.log("LOGIN ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ================================
// SUPERVISOR LOGIN (FIXED)
// ================================

const supervisorLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({
      email: email?.toLowerCase().trim(),
      role: "supervisor",
    }).select("+password");

    if (!user || !user.password) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    return sendToken(user, res);
  } catch (err) {
    console.log("SUPERVISOR LOGIN ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ================================
// EXPORT
// ================================

module.exports = {
  register,
  login,
  supervisorLogin,
};
