const User = require("../models/User");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "d5a8161f29822be327aedda003ae85cfbefd1506d280761cd0b068108d678c7d24554eecd936e61855947d34b0947402b9fedd098c8b1bd2247928449eb6b8e6";

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
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;

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
            <p style="color: #475569; line-height: 1.6;">Your digital infrastructure has been successfully provisioned. Your account is active and ready for operations.</p>
            
            <div style="background-color: #f8fafc; border-left: 4px solid #1e3a8a; padding: 20px; margin: 25px 0;">
              <h3 style="color: #1e3a8a; margin-top: 0; font-size: 16px;">VIRTUAL BANKING ENTITY</h3>
              <p style="margin: 8px 0; color: #1e293b;"><strong>BANK:</strong> ${user.bankName || "Wema Bank"}</p>
              <p style="margin: 8px 0; color: #1e293b;"><strong>ACCOUNT NUMBER:</strong> <span style="font-size: 18px; color: #1e3a8a; letter-spacing: 1px;">${user.accountNumber || "Pending"}</span></p>
              <p style="margin: 8px 0; color: #1e293b;"><strong>ACCOUNT NAME:</strong> ${user.accountName || user.name}</p>
            </div>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error("[Email Error] Failed to send welcome email:", error.message);
  }
};

// --- Helper: Generate and Send JWT Token ---
const sendToken = (user, statusCode, res) => {
  const isOwner =
    user.phone === "09033738409" ||
    String(user.email || "").toLowerCase() === "mohammed.ayas@ayaxdata.online";

  const effectiveRole = isOwner ? "superadmin" : (user.role || "user");

  const token = jwt.sign(
    {
      id: user._id,
      _id: user._id,
      role: effectiveRole,
      state: user.state,
      lga: user.lga,
    },
    JWT_SECRET,
    {
      expiresIn: "30d",
    }
  );

  const hasPinSet = Boolean(
    (user.transactionPin && user.transactionPin !== "0000") ||
    (user.pin && user.pin !== "0000")
  );

  return res.status(statusCode).json({
    success: true,
    token,
    role: effectiveRole,
    user: {
      id: user._id,
      _id: user._id,
      name: user.name || `${user.firstName || ""} ${user.surname || ""}`.trim(),
      firstName: user.firstName || "Mohammed",
      surname: user.surname || "Ayas",
      email: user.email,
      phone: user.phone,
      role: effectiveRole,
      walletBalance: user.walletBalance ?? user.balance ?? 0,
      balance: user.balance ?? user.walletBalance ?? 0,
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
  if (!secretKey) return user;

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
    axiosConfig
  );

  const customerCode = customerResponse.data.data.customer_code;

  const accountResponse = await axios.post(
    "https://api.paystack.co/dedicated_account",
    {
      customer: customerCode,
      preferred_bank: "wema-bank",
    },
    axiosConfig
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
    { new: true }
  );
};

// @desc Register a new user
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

    const cleanEmail = email.toLowerCase().trim();
    const cleanPhone = phone.trim();

    const existingUser = await User.findOne({
      $or: [{ email: cleanEmail }, { phone: cleanPhone }],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email or phone",
      });
    }

    let referralId = undefined;
    if (["supervisor", "field_supervisor", "agent", "state_manager", "leader"].includes(role)) {
      referralId = generateReferralId(firstName, surname);
    }

    const user = await User.create({
      firstName: firstName.trim(),
      surname: surname.trim(),
      otherName: otherName || "",
      name: `${firstName} ${surname}`.toUpperCase().trim(),
      email: cleanEmail,
      phone: cleanPhone,
      password,
      role: role || "user",
      referralId,
      state: state || "Kano",
      lga: lga || "Central",
      address,
    });

    try {
      const updatedUser = await createDedicatedAccount(user);
      await sendWelcomeEmail(updatedUser);
      return sendToken(updatedUser, 201, res);
    } catch (paystackError) {
      await sendWelcomeEmail(user);
      return sendToken(user, 201, res);
    }
  } catch (error) {
    console.error("Critical Registration Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc Universal Login Protocol
exports.login = async (req, res) => {
  try {
    const { identifier, email, phone, password } = req.body;
    const rawInput = String(identifier || email || phone || "").trim();

    if (!rawInput || !password) {
      return res.status(400).json({
        success: false,
        message: "Credentials required (Phone/Email and Password).",
      });
    }

    const cleanInput = rawInput.trim();
    const cleanEmail = cleanInput.toLowerCase();

    // 1. EMERGENCY SUPERADMIN MASTER BYPASS (KOFAR SHIGA NAN TAKE GA MAMALLAKI)
    const isOwner =
      cleanEmail === "mohammed.ayas@ayaxdata.online" ||
      cleanInput === "09033738409" ||
      cleanInput === "+2349033738409";

    const isMasterPass =
      password === "Password123@" ||
      password === "Ayax@2026" ||
      password === "admin123";

    if (isOwner && isMasterPass) {
      let superUser = await User.findOne({
        $or: [
          { email: "mohammed.ayas@ayaxdata.online" },
          { phone: "09033738409" },
        ],
      });

      if (!superUser) {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);
        superUser = await User.create({
          firstName: "Mohammed",
          surname: "Ayas",
          name: "MOHAMMED AYAS",
          email: "mohammed.ayas@ayaxdata.online",
          phone: "09033738409",
          password: hash,
          role: "superadmin",
          walletBalance: 1000000,
          balance: 1000000,
          pin: "1997",
          transactionPin: "1997",
          isSuspended: false,
        });
      } else {
        superUser.role = "superadmin";
        await superUser.save({ validateBeforeSave: false });
      }

      return sendToken(superUser, 200, res);
    }

    // 2. STANDARD DB USER SEARCH
    const user = await User.findOne({
      $or: [
        { phone: cleanInput },
        { email: cleanEmail },
        { phone: cleanInput.replace(/^0/, "+234") },
        { phone: cleanInput.replace(/^\+234/, "0") },
      ],
    }).select("+password +pin +transactionPin");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Authentication failed: Account not found.",
      });
    }

    // 3. DUBA IDAN AN DAKATAR DA SHI
    if (user.isSuspended && !isOwner) {
      return res.status(403).json({
        success: false,
        message: "Your account is currently suspended. Please contact executive administration.",
      });
    }

    // 4. DUBA PASSWORD (BCRYPT, PLAIN TEXT DA SCHEMA METHOD)
    let isMatch = false;

    if (user.password) {
      try {
        isMatch = await bcrypt.compare(password, user.password);
      } catch (e) {
        isMatch = false;
      }
    }

    if (!isMatch && typeof user.matchPassword === "function") {
      try {
        isMatch = await user.matchPassword(password);
      } catch (e) {
        isMatch = false;
      }
    }

    if (!isMatch && user.password === password) {
      isMatch = true;
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);
      await user.save({ validateBeforeSave: false });
    }

    if (!isMatch && isOwner) {
      // Idan asusunka ne amma password bai yi daidai da na DB ba, duba master passwords
      if (isMasterPass) {
        isMatch = true;
      }
    }

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Authentication failed: Invalid credentials.",
      });
    }

    // Tabbatar da matsayin SuperAdmin idan asusunka ne
    if (isOwner && user.role !== "superadmin") {
      user.role = "superadmin";
      await user.save({ validateBeforeSave: false });
    }

    return sendToken(user, 200, res);
  } catch (error) {
    console.error("Login Protocol Error:", error);
    return res.status(500).json({
      success: false,
      message: "Authentication server error.",
      error: error.message,
    });
  }
};

exports.supervisorLogin = exports.login;

// =======================================
// FORGOT PASSWORD & OTP SYSTEM
// =======================================

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
      if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
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
              <p>Your OTP code to reset password is:</p>
              <div style="background: #eff6ff; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; color: #1e3a8a; letter-spacing: 5px; border-radius: 8px; margin: 20px 0;">
                ${otp}
              </div>
              <p>This code expires in 10 minutes.</p>
            </div>
          `,
        });
      }
    } catch (mailErr) {
      console.error("OTP Email Dispatch Error:", mailErr.message);
    }

    return res.status(200).json({
      success: true,
      message: "Verification OTP has been sent to your registered email.",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

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
      message: "Password reset successful. You can now login.",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
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
        }
      );
      console.log(`✅ Wallet funded: ${customerEmail} - ₦${creditValue}`);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ WEBHOOK ERROR:", error);
    return res.status(500).json({ success: false, error: error.message });
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

    let isMatch = false;
    if (typeof user.matchPassword === "function") {
      isMatch = await user.matchPassword(currentPassword);
    }
    if (!isMatch && user.password) {
      isMatch = await bcrypt.compare(currentPassword, user.password);
    }

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Security check failed: Current password incorrect.",
      });
    }

    user.password = newPassword;
    await user.save();

    return res.status(200).json({ success: true, message: "Password updated successfully." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.createPin = async (req, res) => {
  try {
    const pinToUse = req.body.newPin || req.body.pin;

    if (!pinToUse || pinToUse.length !== 4) {
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

    const salt = await bcrypt.genSalt(10);
    const hashedPin = await bcrypt.hash(pinToUse, salt);

    user.pin = hashedPin;
    user.transactionPin = hashedPin;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      success: true,
      message: "Transaction PIN successfully created.",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updatePin = async (req, res) => {
  try {
    const { password } = req.body;
    const pinToUse = req.body.newPin || req.body.pin;

    if (!password || !pinToUse) {
      return res.status(400).json({
        success: false,
        message: "Please provide your account password and the new PIN.",
      });
    }

    if (pinToUse.length !== 4) {
      return res.status(400).json({
        success: false,
        message: "Transaction PIN must be exactly 4 digits.",
      });
    }

    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("+password");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    let isPasswordMatch = false;
    if (typeof user.matchPassword === "function") {
      isPasswordMatch = await user.matchPassword(password);
    }
    if (!isPasswordMatch && user.password) {
      isPasswordMatch = await bcrypt.compare(password, user.password);
    }

    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: "Incorrect account password. Authorization failed.",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPin = await bcrypt.hash(pinToUse, salt);

    user.pin = hashedPin;
    user.transactionPin = hashedPin;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      success: true,
      message: "Transaction PIN successfully updated.",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};