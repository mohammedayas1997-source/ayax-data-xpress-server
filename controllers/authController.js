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
            <h2 style="color: #0f172a;">Welcome, ${user.firstName || user.name}!</h2>
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
      bankName: bankData.bank.name,
      accountNumber: bankData.account_number,
      accountName: bankData.account_name,
    },
    { new: true },
  );
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

      // DISPATCH REAL-TIME EMAIL NOTIFICATION
      await sendWelcomeEmail(updatedUser);

      return sendToken(updatedUser, 201, res);
    } catch (paystackError) {
      console.error(
        "Paystack Provisioning Failure:",
        paystackError.response?.data || paystackError.message,
      );

      // Fallback: Notify user even if banking entity generation delayed
      await sendWelcomeEmail(user);
      return sendToken(user, 201, res);
    }
  } catch (error) {
    console.error("Critical Registration Error:", error);
    res
      .status(500)
      .json({ success: false, message: "Internal server processing failure." });
  }
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

// @desc    Authenticate Supervisor & session initialization
exports.supervisorLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Credentials required.",
      });
    }

    const user = await User.findOne({
      email: email.toLowerCase().trim(),
    }).select("+password");

    if (!user || !(await user.matchPassword(password)) || user.role !== "supervisor") {
      return res.status(401).json({
        success: false,
        message: "Authentication failed: Unauthorized supervisor parameters.",
      });
    }

    sendToken(user, 200, res);
  } catch (error) {
    console.error("Supervisor Login Protocol Error:", error);
    res.status(500).json({
      success: false,
      message: "Authentication server error.",
    });
  }
};

// @desc    Paystack Webhook for Real-Time Wallet Funding
exports.paystackWebhook = async (req, res) => {
  try {
    const event = req.body;

    if (event.event === "charge.success") {
      const { customer, amount } = event.data;
      const creditValue = amount / 100;

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