const User = require("../models/User");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const nodemailer = require("nodemailer");

// --- Helper: Generate Referral ID for Supervisors ---
const generateReferralId = (firstName, surname) => {
  const firstInitial = firstName ? firstName[0] : "A";
  const lastInitial = surname ? surname[0] : "X";
  const initials = (firstInitial + lastInitial).toUpperCase();
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `${initials}${digits}`;
};

// --- Helper: Automated Email Dispatch System ---
const sendWelcomeEmail = async (user) => {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"Ayax Data Xpress" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: "Infrastructure Deployed: Welcome to Ayax Data Xpress",
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #1e3a8a; padding: 20px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px;">AYAX DATA XPRESS</h1>
          </div>
          <div style="padding: 30px; background-color: #ffffff;">
            <h2 style="color: #0f172a;">Welcome, ${user.firstName}!</h2>
            <p style="color: #475569; line-height: 1.6;">Your digital infrastructure has been successfully provisioned. Your account is now active and integrated with our real-time banking nodes.</p>
            
            <div style="background-color: #f8fafc; border-left: 4px solid #1e3a8a; padding: 20px; margin: 25px 0;">
              <h3 style="color: #1e3a8a; margin-top: 0; font-size: 16px;">VIRTUAL BANKING ENTITY</h3>
              <p style="margin: 8px 0; color: #1e293b;"><strong>BANK:</strong> ${user.bankName || "Wema Bank"}</p>
              <p style="margin: 8px 0; color: #1e293b;"><strong>ACCOUNT NUMBER:</strong> <span style="font-size: 18px; color: #1e3a8a; letter-spacing: 1px;">${user.accountNumber || "Initialization Pending"}</span></p>
              <p style="margin: 8px 0; color: #1e293b;"><strong>ACCOUNT NAME:</strong> ${user.accountName || user.name}</p>
            </div>

            <p style="color: #475569; font-size: 14px;">You can now fund your wallet via the account number provided above to begin operations.</p>
            
            <div style="text-align: center; margin-top: 35px;">
              <a href="https://ayax-data-xpress.com/login" style="background-color: #1e3a8a; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px;">ACCESS DASHBOARD</a>
            </div>
          </div>
          <div style="background-color: #f1f5f9; padding: 20px; text-align: center; color: #94a3b8; font-size: 12px;">
            <p>&copy; 2026 Ayax Data Xpress Terminal. All Rights Reserved.</p>
            <p>Secure financial infrastructure automated by Paystack & Wema.</p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(
      `[Email Success] Welcome notification transmitted to ${user.email}`,
    );
  } catch (error) {
    console.error(
      "[Email Error] Failed to transmit welcome notification:",
      error.message,
    );
  }
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
    status: "success",
    token,
    role: user.role,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      balance: user.walletBalance || 0,
      role: user.role,
      referralId: user.referralId,
      accountNumber: user.accountNumber || "Initialization Pending",
      bankName: user.bankName || "Wema Bank",
      accountName: user.accountName || user.name,
      state: user.state,
      lga: user.lga,
      address: user.address,
    },
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        balance: user.walletBalance || 0,
        role: user.role,
        referralId: user.referralId,
        accountNumber: user.accountNumber || "Initialization Pending",
        bankName: user.bankName || "Wema Bank",
        accountName: user.accountName || user.name,
        state: user.state,
        lga: user.lga,
        address: user.address,
      },
    },
  });
};

// @desc    Register a new user with Automated Paystack Virtual Account & Email
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

    let referralId = undefined;
    if (role === "supervisor" || role === "agent") {
      referralId = generateReferralId(firstName, surname);
    }

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

    try {
      const updatedUser = await createDedicatedAccount(user);

      // GYARA NA KWARAI: An cire 'await' a nan don aiko da Email a bayan fage, ba tare da ya tsaida frontend tana juyawa ba
      sendWelcomeEmail(updatedUser);

      return sendToken(updatedUser, 201, res);
    } catch (paystackError) {
      console.error(
        "Paystack Provisioning Failure:",
        paystackError.response?.data || paystackError.message,
      );

      const fallbackUser = await User.findByIdAndUpdate(
        user._id,
        {
          bankName: "Wema Bank",
          accountNumber: "Initialization Pending",
          accountName: `${user.firstName} ${user.surname}`.toUpperCase(),
        },
        { new: true },
      );

      // GYARA NA KWARAI: An cire 'await' a nan ma don gudun jinkiri idan an fada fallback
      sendWelcomeEmail(fallbackUser);
      return sendToken(fallbackUser, 201, res);
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

  const accountResponse = await axios.post(
    "https://api.paystack.co/dedicated_account",
    {
      customer: customerCode,
      preferred_bank: "wema-bank",
    },
    axiosConfig,
  );

  const bankData = accountResponse.data.data;

  return await User.findByIdAndUpdate(
    user._id,
    {
      paystackCustomerCode: customerCode,
      bankName: bankData.bank.name || "Wema Bank",
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

    // Tabbatar da cewa akwai bayanai
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        status: "fail",
        message: "Credentials required.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log("🔍 Searching for user in DB:", normalizedEmail);

    // Neman user a database
    const user = await User.findOne({ email: normalizedEmail }).select(
      "+password",
    );

    // Idan babu user, kada ka ce "Invalid password", ka ce "Invalid credentials"
    if (!user) {
      console.log("❌ User not found with email:", normalizedEmail);
      return res.status(401).json({
        success: false,
        status: "fail",
        message: "Authentication failed: Invalid email or password.",
      });
    }

    // Tabbatar da password
    const isMatch = await user.matchPassword(password);
    console.log("🔐 Password match status for", normalizedEmail, ":", isMatch);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        status: "fail",
        message: "Authentication failed: Invalid email or password.",
      });
    }

    // Idan komai ya tafi daidai
    console.log("✅ Login successful for:", normalizedEmail);
    sendToken(user, 200, res);
  } catch (error) {
    console.error("🚨 Login Protocol Error:", error);
    res.status(500).json({
      success: false,
      status: "error",
      message: "Authentication server error.",
    });
  }
};

// @desc    Paystack Webhook for Real-Time Wallet Funding
exports.paystackWebhook = async (req, res) => {
  try {
    const event = req.body;

    // ... ciki na paystackWebhook
    if (event.event === "charge.success") {
      const { customer, amount } = event.data;
      const creditValue = amount / 100;

      // GA GYARAN: Kada ka yi amfani da 'email' nan, ka yi amfani da 'customer.email'
      console.log("🔍 Processing funding for:", customer.email);

      await User.findOneAndUpdate(
        { email: customer.email }, // Ka tabbatar wannan shi ne key
        { $inc: { walletBalance: creditValue } },
      );
      // ...

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
  await User.findByIdAndUpdate(req.user.id, { pin: newPin });
  res
    .status(200)
    .json({ success: true, message: "Transaction PIN synchronized." });
};

// Get User Profile Method
exports.getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        status: "fail",
        message: "User not found with this ID",
      });
    }

    res.status(200).json({
      status: "success",
      data: {
        user,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
};

module.exports = {
  register,
  login,
  supervisorLogin,
  paystackWebhook,
  updatePassword,
  updatePin,
};
