const User = require("../models/User");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");

// DYNAMIC/SAFE ACTIVITY MODEL IMPORT
let Activity;
try {
  Activity = require("../models/Activity");
} catch (e) {
  try {
    Activity = require("../models/activityModel");
  } catch (err) {
    Activity = null;
  }
}

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

  const isSupport =
    String(user.email || "").toLowerCase() === "support@ayaxdata.online" ||
    user.phone === "08077778888";

  let effectiveRole = user.role || "user";
  if (isOwner) effectiveRole = "superadmin";
  else if (isSupport) effectiveRole = "support";

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
      firstName: user.firstName || "Customer",
      surname: user.surname || "Support",
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

// @desc    Register / Signup User or Agent
// @route   POST /api/v1/auth/register
exports.register = async (req, res) => {
  try {
    const {
      firstName,
      surname,
      otherName,
      name,
      email,
      phone,
      password,
      role,
      state,
      lga,
      address,
      supervisorId,
      referralCode,
      referredBy,
    } = req.body;

    if (!phone || (!firstName && !name)) {
      return res.status(400).json({
        success: false,
        message: "First Name and Phone Number are required.",
      });
    }

    const cleanPhone = String(phone).trim();
    const cleanEmail = email
      ? String(email).toLowerCase().trim()
      : `${cleanPhone}@ayaxdata.online`;

    let existingUser = await User.findOne({
      $or: [{ phone: cleanPhone }, { email: cleanEmail }],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "An account with this phone number or email already exists.",
      });
    }

    const activeRef = String(referralCode || referredBy || supervisorId || "").trim();
    let assignedSupId = null;
    let assignedSupName = null;
    let finalState = state ? String(state).trim() : "Kano";
    let finalLga = lga ? String(lga).trim() : "Ajingi";

    if (activeRef) {
      const phoneDigits = activeRef.replace(/[^0-9]/g, "");
      const supervisor = await User.findOne({
        $or: [
          { referralCode: new RegExp(`^${activeRef}$`, "i") },
          { referralId: new RegExp(`^${activeRef}$`, "i") },
          ...(phoneDigits.length >= 10 ? [{ phone: phoneDigits }, { phone: `0${phoneDigits.slice(-10)}` }] : []),
          ...(phoneDigits.length >= 4 ? [{ phone: new RegExp(`${phoneDigits}$`, "i") }] : []),
        ],
      });

      if (supervisor) {
        assignedSupId = supervisor._id;
        assignedSupName = supervisor.name || `${supervisor.firstName || ""} ${supervisor.surname || ""}`.trim();
        finalState = supervisor.state || finalState;
        finalLga = supervisor.lga || finalLga;
      }
    }

    if (!assignedSupId && finalLga && finalState) {
      const lgaSupervisor = await User.findOne({
        role: { $in: ["supervisor", "field_supervisor"] },
        lga: new RegExp(`^${finalLga}$`, "i"),
        state: new RegExp(`^${finalState}$`, "i"),
      });

      if (lgaSupervisor) {
        assignedSupId = lgaSupervisor._id;
        assignedSupName = lgaSupervisor.name || `${lgaSupervisor.firstName || ""} ${lgaSupervisor.surname || ""}`.trim();
      }
    }

    const first = firstName || (name ? name.trim().split(" ")[0] : "Retail");
    const sur = surname || (name ? name.trim().split(" ").slice(1).join(" ") : "Agent");
    const fullName = name || `${first} ${sur}`.trim();

    const newUser = await User.create({
      firstName: first,
      surname: sur,
      otherName: otherName || "",
      name: fullName.toUpperCase().trim(),
      email: cleanEmail,
      phone: cleanPhone,
      password: password || "Password123@",
      pin: "2026",
      transactionPin: "2026",
      role: role && role.toLowerCase() === "agent" ? "agent" : (activeRef ? "agent" : "user"),
      state: finalState,
      lga: finalLga,
      address: address || `${finalLga} LGA`,
      referredBy: activeRef || undefined,
      supervisorId: activeRef || undefined,
      assignedSupervisor: assignedSupId,
      assignedSupervisorName: assignedSupName,
      walletBalance: 0,
      balance: 0,
      isSuspended: false,
      isVerified: true,
      status: "active",
      targets: {
        dataGoal: 0,
        airtimeGoal: 0,
        currentMonth: "August 2026",
      },
    });

    try {
      if (Activity && assignedSupId) {
        await Activity.create({
          staffId: assignedSupId,
          user: assignedSupId,
          lga: finalLga,
          state: finalState,
          action: "AGENT_REGISTERED",
          details: `Retail Agent ${newUser.name} (${cleanPhone}) registered under LGA supervision.`,
          targetUser: newUser._id,
        });
      }
    } catch (logErr) {
      console.log("Activity log skipped:", logErr.message);
    }

    const token = typeof newUser.getSignedJwtToken === "function" 
      ? newUser.getSignedJwtToken() 
      : jwt.sign(
          { id: newUser._id, _id: newUser._id, role: newUser.role, state: newUser.state, lga: newUser.lga },
          JWT_SECRET,
          { expiresIn: "30d" }
        );

    return res.status(201).json({
      success: true,
      message: "Registration successful!",
      token,
      user: newUser,
      data: newUser,
    });
  } catch (error) {
    console.error("Register Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Registration failed.",
    });
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

    // 1. EMERGENCY SUPERADMIN MASTER BYPASS
    const isOwner =
      cleanEmail === "mohammed.ayas@ayaxdata.online" ||
      cleanInput === "09033738409" ||
      cleanInput === "+2349033738409";

    const isSupportDesk =
      cleanEmail === "support@ayaxdata.online" ||
      cleanInput === "08077778888" ||
      cleanInput === "+2348077778888";

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
        superUser = await User.create({
          firstName: "Mohammed",
          surname: "Ayas",
          name: "MOHAMMED AYAS",
          email: "mohammed.ayas@ayaxdata.online",
          phone: "09033738409",
          password: password,
          role: "superadmin",
          walletBalance: 1000000,
          balance: 1000000,
          pin: "1997",
          transactionPin: "1997",
          isSuspended: false,
          isVerified: true,
          status: "active",
        });
      } else {
        superUser.role = "superadmin";
        superUser.isSuspended = false;
        superUser.password = password;
        await superUser.save({ validateBeforeSave: false });
      }

      return sendToken(superUser, 200, res);
    }

    // 2. EMERGENCY CUSTOMER SUPPORT DESK MASTER BYPASS
    if (isSupportDesk && isMasterPass) {
      let supportUser = await User.findOne({
        $or: [
          { email: "support@ayaxdata.online" },
          { phone: "08077778888" },
        ],
      });

      if (!supportUser) {
        supportUser = await User.create({
          firstName: "Customer",
          surname: "Support",
          name: "CUSTOMER SUPPORT",
          email: "support@ayaxdata.online",
          phone: "08077778888",
          password: password,
          role: "support",
          walletBalance: 10000,
          balance: 10000,
          pin: "2026",
          transactionPin: "2026",
          isSuspended: false,
          isVerified: true,
          status: "active",
        });
      } else {
        supportUser.role = "support";
        supportUser.isSuspended = false;
        supportUser.password = password;
        await supportUser.save({ validateBeforeSave: false });
      }

      return sendToken(supportUser, 200, res);
    }

    // 3. STANDARD DB USER SEARCH (CASE-INSENSITIVE)
    const user = await User.findOne({
      $or: [
        { phone: cleanInput },
        { email: new RegExp(`^${cleanEmail}$`, "i") },
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

    // 4. DUBA IDAN AN DAKATAR DA SHI
    if (user.isSuspended && !isOwner && !isSupportDesk) {
      return res.status(403).json({
        success: false,
        message: "Your account is currently suspended. Please contact executive administration.",
      });
    }

    // 5. DUBA PASSWORD
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
      user.password = password;
      await user.save({ validateBeforeSave: false });
    }

    if (!isMatch && (isOwner || isSupportDesk) && isMasterPass) {
      isMatch = true;
      user.password = password;
      await user.save({ validateBeforeSave: false });
    }

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Authentication failed: Invalid credentials.",
      });
    }

    if (isOwner && user.role !== "superadmin") {
      user.role = "superadmin";
      await user.save({ validateBeforeSave: false });
    } else if (isSupportDesk && user.role !== "support") {
      user.role = "support";
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

// Models da ake bukata (Tabbatar kana da su a saman fayil din)
const Transaction = require("../models/Transaction");
let Notification;
try {
  Notification = require("../models/Notification");
} catch (e) {
  try {
    Notification = require("../models/notificationModel");
  } catch (err) {
    Notification = null;
  }
}

// =======================================
// INGANNTACCEN PAYSTACK / MONNIFY WEBHOOK
// =======================================
exports.paystackWebhook = async (req, res) => {
  try {
    const event = req.body;

    // Duba idan biya ya yi nasara (Paystack ko DVA Transfer)
    if (
      event.event === "charge.success" ||
      event.event === "dedicated_account.assign.success" ||
      event.eventType === "SUCCESSFUL_TRANSACTION"
    ) {
      const data = event.data || event.eventData || {};
      const customerEmail = String(data.customer?.email || data.customerEmail || "").toLowerCase().trim();
      const amountPaid = Number(data.amount || 0) / (event.event === "charge.success" ? 100 : 1);
      const reference = data.reference || data.transactionReference || `FUND-${Date.now()}`;

      // 1. Nemo User a Database
      const user = await User.findOne({
        $or: [
          { email: customerEmail },
          { phone: customerEmail.split("@")[0] }
        ]
      });

      if (user && amountPaid > 0) {
        // Duba kada a saka kudi sau biyu (Idempotency Check)
        const alreadyExists = await Transaction.findOne({ reference });
        if (!alreadyExists) {
          const previousBalance = Number(user.walletBalance || user.balance || 0);
          const newBalance = previousBalance + amountPaid;

          // 2. Sabunta Wallet Balance na User
          user.walletBalance = newBalance;
          user.balance = newBalance;
          await user.save({ validateBeforeSave: false });

          // 3. Kirkirar Record a Transaction History
          await Transaction.create({
            user: user._id,
            userId: user._id,
            type: "wallet_funding",
            service: "Wallet Funding",
            category: "WALLET",
            amount: amountPaid,
            previousBalance: previousBalance,
            newBalance: newBalance,
            reference: reference,
            status: "success",
            description: `Automated Wallet Deposit of ₦${amountPaid.toLocaleString()}`,
            createdAt: new Date(),
          });

          // 4. Kirkirar Notification mai aiki
          if (Notification) {
            await Notification.create({
              user: user._id,
              recipient: user._id,
              title: "Wallet Credit Alert 💳",
              message: `Your wallet has been credited with ₦${amountPaid.toLocaleString()} via Automated Dedicated Transfer. New Balance: ₦${newBalance.toLocaleString()}.`,
              category: "PAYMENT_SUCCESS",
              isRead: false,
              read: false,
              status: "unread",
              createdAt: new Date(),
            });
          }

          console.log(`✅ [WALLET FUNDED]: ₦${amountPaid} credited to ${user.phone || user.email}. Ref: ${reference}`);
        }
      }
    }

    return res.status(200).json({ status: "success", message: "Webhook acknowledged" });
  } catch (error) {
    console.error("❌ WEBHOOK PROCESSING ERROR:", error);
    return res.status(500).json({ status: "error", message: error.message });
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