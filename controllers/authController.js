const User = require("../models/User");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const nodemailer = require("nodemailer");

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
    console.log(`[Email Success] Welcome notification transmitted to ${user.email}`);
  } catch (error) {
    console.error("[Email Error] Failed to transmit welcome notification:", error.message);
  }
};

// --- Helper: Generate and Send JWT Token ---
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

  const hasPinSet = !!(user.transactionPin || user.pin);

  return res.status(statusCode).json({
    success: true,
    token,
    role: user.role,
    user: {
      id: user._id,
      name: user.name,
      firstName: user.firstName,
      surname: user.surname,
      email: user.email,
      phone: user.phone,
      role: user.role,
      walletBalance: user.walletBalance || user.balance || 0,
      referralId: user.referralId,
      bankName: user.bankName || "Wema Bank",
      accountNumber: user.accountNumber || "Pending",
      accountName: user.accountName || user.name,
      state: user.state,
      lga: user.lga,
      address: user.address,
      has_transaction_pin: hasPinSet,
      hasPin: hasPinSet,
    },
  });
};

// --- Paystack Dedicated Account Logic ---
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

// @desc    Register a new user
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

    let referralId = undefined;
    if (role === "supervisor" || role === "agent" || role === "staff") {
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

    try {
      const updatedUser = await createDedicatedAccount(user);
      await sendWelcomeEmail(updatedUser);
      return sendToken(updatedUser, 201, res);
    } catch (paystackError) {
      console.error(
        "Paystack Provisioning Failure:",
        paystackError.response?.data || paystackError.message,
      );
      await sendWelcomeEmail(user);
      return sendToken(user, 201, res);
    }
  } catch (error) {
    console.error("Critical Registration Error:", error);
    return res.status(500).json({ success: false, message: "Internal server processing failure.", error: error.message });
  }
};

// @desc    Universal Login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Credentials required." });
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

    return sendToken(user, 200, res);
  } catch (error) {
    console.error("Login Protocol Error:", error);
    return res.status(500).json({ success: false, message: "Authentication server error.", error: error.message });
  }
};

exports.supervisorLogin = exports.login;

// =======================================
// FORGOT PASSWORD & OTP SYSTEM
// =======================================

// @desc    Send OTP to user's registered email and phone for password reset
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "Please provide an email address." });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If an account exists with this email, an OTP has been sent.",
      });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    
    user.resetPasswordToken = otp;
    user.resetPasswordExpire = Date.now() + 10 * 60 * 1000;
    await user.save({ validateBeforeSave: false });

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
        subject: "Password Reset OTP Code",
        html: `
          <div style="font-family: Arial; padding: 20px; max-width: 500px; margin: auto; border: 1px solid #e2e8f0; border-radius: 10px;">
            <h2 style="color: #1e3a8a;">Password Reset Security</h2>
            <p>Hello ${user.firstName || "User"},</p>
            <p>You requested a password reset for your Ayax Data Xpress account. Use the OTP code below to proceed:</p>
            <div style="background: #eff6ff; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; color: #1e3a8a; letter-spacing: 5px; border-radius: 8px; margin: 20px 0;">
              ${otp}
            </div>
            <p>This code expires in 10 minutes. If you didn't request this, please ignore this email.</p>
          </div>
        `,
      });
    } catch (mailErr) {
      console.error("OTP Email Dispatch Error:", mailErr.message);
    }

    console.log(`[OTP Generated for ${user.phone} / ${user.email}]: ${otp}`);

    return res.status(200).json({
      success: true,
      message: "Verification OTP has been sent to your registered email and phone number.",
    });
  } catch (error) {
    console.error("Forgot Password Error:", error);
    return res.status(500).json({ success: false, message: "Server error during forgot password processing." });
  }
};

// @desc    Verify OTP and update user password
exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: "Please provide email, OTP, and new password." });
    }

    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      resetPasswordToken: otp,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP code." });
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password reset successful. You can now login with your new password.",
    });
  } catch (error) {
    console.error("Reset Password Error:", error);
    return res.status(500).json({ success: false, message: "Server error during password reset." });
  }
};

// =======================================
// PAYSTACK WEBHOOK
// =======================================

exports.paystackWebhook = async (req, res) => {
  try {
    const event = req.body;

    if (event.event === "charge.success") {
      const { customer, amount } = event.data;
      const customerEmail = customer.email;
      const creditValue = amount / 100;

      await User.findOneAndUpdate(
        { email: customerEmail },
        {
          $inc: {
            walletBalance: creditValue,
            balance: creditValue,
          },
        },
      );

      console.log(`✅ Wallet funded: ${customerEmail} - ₦${creditValue}`);
    }

    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    console.log("❌ WEBHOOK ERROR:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// =======================================
// UPDATE PASSWORD & PIN
// =======================================

exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide current and new passwords.",
      });
    }

    const user = await User.findById(req.user.id).select("+password");

    if (!(await user.matchPassword(currentPassword))) {
      return res.status(401).json({
        success: false,
        message: "Security check failed: Current key incorrect.",
      });
    }

    user.password = newPassword;
    await user.save();
    
    return res.status(200).json({ success: true, message: "Security parameters updated." });
  } catch (error) {
    console.error("Update Password Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating password.",
      error: error.message,
    });
  }
};

// @desc    Create Transaction PIN (First time)
exports.createPin = async (req, res) => {
  try {
    const { newPin } = req.body;

    if (!newPin || newPin.length !== 4) {
      return res.status(400).json({
        success: false,
        message: "Valid 4-digit PIN required.",
      });
    }

    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    // Ana adana PIN ta kowace hanya da database kake amfani da ita (pin ko transactionPin)
    user.pin = newPin;
    user.transactionPin = newPin;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Transaction PIN successfully created.",
    });
  } catch (error) {
    console.error("Create PIN Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while creating PIN.",
      error: error.message,
    });
  }
};

// @desc    Update Transaction PIN using Account Password
exports.updatePin = async (req, res) => {
  try {
    const { password, newPin } = req.body;

    if (!password || !newPin) {
      return res.status(400).json({
        success: false,
        message: "Please provide your account password and the new PIN.",
      });
    }

    if (newPin.length !== 4) {
      return res.status(400).json({
        success: false,
        message: "Transaction PIN must be exactly 4 digits.",
      });
    }

    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("+password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    const isPasswordMatch = await user.matchPassword(password);
    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: "Incorrect account password. Authorization failed.",
      });
    }

    user.pin = newPin;
    user.transactionPin = newPin;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Transaction PIN successfully updated.",
    });
  } catch (error) {
    console.error("Update PIN Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating PIN.",
      error: error.message,
    });
  }
};