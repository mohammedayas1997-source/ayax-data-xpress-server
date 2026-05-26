const User = require("../models/User");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const nodemailer = require("nodemailer");

// =======================================
// GENERATE REFERRAL ID
// =======================================

const generateReferralId = (firstName, surname) => {
  const firstInitial = firstName ? firstName[0] : "A";
  const lastInitial = surname ? surname[0] : "X";
  const initials = (firstInitial + lastInitial).toUpperCase();
  const digits = Math.floor(1000 + Math.random() * 9000);

  return `${initials}${digits}`;
};

// =======================================
// SEND EMAIL
// =======================================

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
      subject: "Welcome To Ayax Data Xpress",
      html: `
        <div style="font-family: Arial; padding:20px;">
          <h2>Welcome ${user.firstName}</h2>

          <p>Your account has been created successfully.</p>

          <h3>Virtual Account Details</h3>

          <p><strong>Bank:</strong> ${user.bankName || "Wema Bank"}</p>

          <p><strong>Account Number:</strong> ${
            user.accountNumber || "Pending"
          }</p>

          <p><strong>Account Name:</strong> ${user.accountName || user.name}</p>
        </div>
      `,
    });

    console.log("✅ Email sent");
  } catch (error) {
    console.log("❌ Email Error:", error.message);
  }
};

// =======================================
// SEND TOKEN
// =======================================

const sendToken = (user, statusCode, res) => {
  const token = jwt.sign(
    {
      id: user._id,
      role: user.role,
    },
    process.env.JWT_SECRET || "fallback_secret",
    {
      expiresIn: "30d",
    },
  );

  return res.status(statusCode).json({
    success: true,
    token,
    role: user.role,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      walletBalance: user.walletBalance || 0,
      referralId: user.referralId,
      bankName: user.bankName || "Wema Bank",
      accountNumber: user.accountNumber || "Pending",
      accountName: user.accountName || user.name,
      state: user.state,
      lga: user.lga,
      address: user.address,
    },
  });
};

// =======================================
// CREATE PAYSTACK ACCOUNT
// =======================================

const createDedicatedAccount = async (user) => {
  try {
    const secretKey = process.env.PAYSTACK_SECRET_KEY;

    if (!secretKey) {
      throw new Error("PAYSTACK_SECRET_KEY missing");
    }

    const config = {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    };

    // CREATE CUSTOMER
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

    // CREATE DEDICATED ACCOUNT
    const account = await axios.post(
      "https://api.paystack.co/dedicated_account",
      {
        customer: customerCode,
        preferred_bank: "wema-bank",
      },
      config,
    );

    const accountData = account.data.data;

    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      {
        paystackCustomerCode: customerCode,
        bankName: accountData.bank.name,
        accountNumber: accountData.account_number,
        accountName: accountData.account_name,
      },
      { new: true },
    );

    return updatedUser;
  } catch (error) {
    console.log("❌ Paystack Error:", error.response?.data || error.message);

    return await User.findByIdAndUpdate(
      user._id,
      {
        bankName: "Wema Bank",
        accountNumber: "Pending",
        accountName: user.name,
      },
      { new: true },
    );
  }
};

// =======================================
// REGISTER
// =======================================

const register = async (req, res) => {
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

    if (!firstName || !surname || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({
      $or: [{ email: normalizedEmail }, { phone: phone.trim() }],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists",
      });
    }

    let referralId;

    if (role === "supervisor" || role === "agent") {
      referralId = generateReferralId(firstName, surname);
    }

    const user = await User.create({
      firstName: firstName.trim(),
      surname: surname.trim(),
      otherName: otherName || "",
      name: `${firstName} ${surname}`,
      email: normalizedEmail,
      phone: phone.trim(),
      password,
      role: role || "user",
      referralId,
      state,
      lga,
      address,
    });

    const updatedUser = await createDedicatedAccount(user);

    sendWelcomeEmail(updatedUser);

    return sendToken(updatedUser, 201, res);
  } catch (error) {
    console.log("❌ REGISTER ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// =======================================
// LOGIN
// =======================================

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password required",
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase().trim(),
    }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    return sendToken(user, 200, res);
  } catch (error) {
    console.log("❌ LOGIN ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// =======================================
// SUPERVISOR LOGIN
// =======================================

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
        message: "Supervisor not found",
      });
    }

    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid password",
      });
    }

    return sendToken(user, 200, res);
  } catch (error) {
    console.log("❌ SUPERVISOR LOGIN ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// =======================================
// PAYSTACK WEBHOOK
// =======================================

const paystackWebhook = async (req, res) => {
  try {
    const event = req.body;

    if (event.event === "charge.success") {
      const customerEmail = event.data.customer.email;
      const amount = event.data.amount / 100;

      await User.findOneAndUpdate(
        { email: customerEmail },
        {
          $inc: {
            walletBalance: amount,
          },
        },
      );

      console.log(`✅ Wallet funded: ${customerEmail} - ₦${amount}`);
    }

    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    console.log("❌ WEBHOOK ERROR:", error);

    return res.status(500).json({
      success: false,
    });
  }
};

// =======================================
// UPDATE PASSWORD
// =======================================

const updatePassword = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("+password");

    const isMatch = await user.matchPassword(req.body.currentPassword);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Wrong current password",
      });
    }

    user.password = req.body.newPassword;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.log("❌ UPDATE PASSWORD ERROR:", error);

    return res.status(500).json({
      success: false,
    });
  }
};

// =======================================
// UPDATE PIN
// =======================================

const updatePin = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, {
      pin: req.body.newPin,
    });

    return res.status(200).json({
      success: true,
      message: "PIN updated successfully",
    });
  } catch (error) {
    console.log("❌ UPDATE PIN ERROR:", error);

    return res.status(500).json({
      success: false,
    });
  }
};

// =======================================
// GET USER PROFILE
// =======================================

const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.log("❌ PROFILE ERROR:", error);

    return res.status(500).json({
      success: false,
    });
  }
};

// =======================================
// EXPORTS
// =======================================

module.exports = {
  register,
  login,
  supervisorLogin,
  paystackWebhook,
  updatePassword,
  updatePin,
  getUserProfile,
};
