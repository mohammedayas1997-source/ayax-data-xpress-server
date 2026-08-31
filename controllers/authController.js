const User = require("../models/User");
const Transaction = require("../models/Transaction");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

// DYNAMIC/SAFE MODEL IMPORTS
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

// ROLE-BASED WELCOME NOTIFICATION GENERATOR
const getWelcomeMessageByRole = (user) => {
  const role = String(user.role || "user").toLowerCase().trim();
  const name = user.firstName || user.name || "Member";
  const state = user.state || "Nigeria";
  const lga = user.lga ? `(${user.lga} LGA)` : "";

  switch (role) {
    case "national_sales_director":
    case "super_leader":
      return {
        title: "Executive Welcome: National Sales Directorate 👑",
        message: `Welcome, ${name}! Your executive portal as National Sales Director (NSD) has been initialized. You have overarching authority to supervise State Managers, allocate state quotas, and oversee nationwide VTU & identity operations.`,
        category: "APPOINTMENT",
      };

    case "state_manager":
    case "leader":
      return {
        title: "Executive Appointment: State Management Directorate 🏛️",
        message: `Welcome, ${name}! You have been appointed as the official State Manager (SM) for ${state} State. Your command console is live to monitor Field Supervisors, track retail agents, and drive regional sales quotas.`,
        category: "APPOINTMENT",
      };

    case "supervisor":
    case "field_supervisor":
      return {
        title: "Field Appointment: Field Operations Supervisor 👔",
        message: `Welcome, ${name}! Your Field Supervisor portal for ${state} ${lga} is now active. You can now onboard, verify, and mentor retail agents, track daily bundle allocations, and supervise regional distribution.`,
        category: "APPOINTMENT",
      };

    case "agent":
      return {
        title: "Welcome to Ayax Retail Agent Network 🏪",
        message: `Welcome on board, Agent ${name}! Your merchant terminal is active. Enjoy exclusive wholesale prices on Data bundles, Airtime VTU, Electricity Tokens, Cable TV, and NIMC/BVN validation services. Start vending and maximize your daily commissions!`,
        category: "WELCOME_AGENT",
      };

    case "support":
    case "customer_service":
    case "customer_care":
      return {
        title: "Ayax Support Desk: Terminal Access Granted 🎧",
        message: `Welcome, ${name}! Your customer resolution and support terminal is provisioned. You can investigate transaction logs, trace NIMC/BVN queries, and escalate customer disputes directly to administration.`,
        category: "SYSTEM_ACCESS",
      };

    case "admin":
      return {
        title: "Operations Command: Admin Console Active 🛡️",
        message: `Welcome, ${name}! Your Operations Administrator account is live. You have elevated access to oversee daily platform operations, service uptime, and support investigations.`,
        category: "ADMIN_ACCESS",
      };

    default: // Normal Customer / User
      return {
        title: "Welcome to Ayax Data Xpress 🚀",
        message: `Welcome, ${name}! Your digital wallet and service portal are fully operational. Enjoy instant, automated delivery for ultra-cheap Data, VTU Airtime, Utility bills, and Identity verification 24/7. Fund your wallet to get started!`,
        category: "WELCOME",
      };
  }
};

// HELPER: SEND JWT TOKEN
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

// Paystack Dedicated Virtual Account Generator
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

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password || "Password123@", salt);

    const newUser = await User.create({
      firstName: first,
      surname: sur,
      otherName: otherName || "",
      name: fullName.toUpperCase().trim(),
      email: cleanEmail,
      phone: cleanPhone,
      password: hashedPassword,
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

    // Automated Role-Based Welcome Notification Dispatch
    const welcome = getWelcomeMessageByRole(newUser);
    const welcomeNotifObj = {
      title: welcome.title,
      message: welcome.message,
      category: welcome.category,
      date: new Date(),
      createdAt: new Date(),
      isRead: false,
      read: false,
    };

    if (!newUser.notifications) newUser.notifications = [];
    newUser.notifications.unshift(welcomeNotifObj);
    await newUser.save({ validateBeforeSave: false });

    if (Notification) {
      await Notification.create({
        recipient: newUser._id,
        user: newUser._id,
        userId: newUser._id,
        title: welcome.title,
        message: welcome.message,
        category: welcome.category,
        type: "welcome",
        isBroadcast: false,
        isGeneral: false,
        target: "specific_users",
        createdAt: new Date(),
      }).catch(() => {});
    }

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
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        superUser = await User.create({
          firstName: "Mohammed",
          surname: "Ayas",
          name: "MOHAMMED AYAS",
          email: "mohammed.ayas@ayaxdata.online",
          phone: "09033738409",
          password: hashedPassword,
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
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        supportUser = await User.create({
          firstName: "Customer",
          surname: "Support",
          name: "CUSTOMER SUPPORT",
          email: "support@ayaxdata.online",
          phone: "08077778888",
          password: hashedPassword,
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

    // 4. SUSPENSION CHECK
    if (user.isSuspended && !isOwner && !isSupportDesk) {
      return res.status(403).json({
        success: false,
        message: "Your account is currently suspended. Please contact executive administration.",
      });
    }

    // 5. PASSWORD VERIFICATION
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

    if (!isMatch && (isOwner || isSupportDesk) && isMasterPass) {
      isMatch = true;
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);
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



// @desc    Initiate Automated Forgot Password (OTP & Direct Magic Link)
// @route   POST /api/v1/auth/forgot-password
exports.forgotPassword = async (req, res) => {
  try {
    const { identifier, email, phone } = req.body;
    const rawInput = String(identifier || email || phone || "").trim();

    if (!rawInput) {
      return res.status(400).json({
        success: false,
        message: "Please provide your registered email address or phone number.",
      });
    }

    const cleanInput = rawInput.toLowerCase();
    const user = await User.findOne({
      $or: [
        { email: new RegExp(`^${cleanInput}$`, "i") },
        { phone: rawInput },
        { phone: rawInput.replace(/^0/, "+234") },
        { phone: rawInput.replace(/^\+234/, "0") },
      ],
    });

    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If an account matches this identity, password reset instructions have been dispatched.",
      });
    }

    // 1. Generate 4-digit OTP Code
    const otpCode = Math.floor(1000 + Math.random() * 9000).toString();

    // 2. Generate Secure Direct One-Click Token Link
    const resetToken = crypto.randomBytes(24).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

    user.resetPasswordToken = otpCode;
    user.resetPasswordLinkToken = tokenHash;
    user.resetPasswordExpire = Date.now() + 15 * 60 * 1000; // 15 minutes expiration
    await user.save({ validateBeforeSave: false });

    // 3. Automated Server Verification Link
    const serverOrigin = process.env.CLIENT_URL || "https://ayaxdata.online";
    const directResetLink = `${serverOrigin}/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`;

    // 4. Robust Automated Mailer Configuration
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    if (!emailUser || !emailPass) {
      console.error("CRITICAL: EMAIL_USER or EMAIL_PASS is missing in server environment variables.");
      return res.status(200).json({
        success: true,
        message: `OTP generated. Server mailer is unconfigured. (Dev OTP: ${otpCode})`,
        data: { email: user.email },
      });
    }

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true, // Use SSL
      auth: {
        user: emailUser,
        pass: emailPass.replace(/\s+/g, ""), // Remove any accidental spaces
      },
      tls: {
        rejectUnauthorized: false,
      },
    });

    await transporter.sendMail({
      from: `"Ayax Data Xpress" <${emailUser}>`,
      to: user.email,
      subject: "Password Reset Authorization - Ayax Data Xpress",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 24px; max-width: 520px; margin: auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #0284c7; margin: 0; font-size: 22px;">Ayax Data Xpress</h2>
            <p style="color: #64748b; font-size: 13px; margin-top: 4px;">Security & Password Authorization</p>
          </div>
          
          <p style="color: #334155; font-size: 14px;">Hello <strong>${user.firstName || user.name || "Customer"}</strong>,</p>
          <p style="color: #475569; font-size: 13px; line-height: 1.5;">We received a password reset request for your account. You can reset your password immediately using the 4-digit OTP below or by clicking the direct authorization button:</p>

          <div style="background-color: #f0f9ff; border: 1px dashed #0284c7; padding: 14px; text-align: center; font-size: 26px; font-weight: 900; color: #0369a1; letter-spacing: 6px; border-radius: 8px; margin: 18px 0;">
            ${otpCode}
          </div>

          <div style="text-align: center; margin: 24px 0;">
            <a href="${directResetLink}" style="background-color: #0284c7; color: #ffffff; text-decoration: none; padding: 12px 24px; font-size: 13px; font-weight: bold; border-radius: 8px; display: inline-block;">
              DIRECT ONE-CLICK PASSWORD RESET
            </a>
          </div>

          <p style="color: #94a3b8; font-size: 11.5px; line-height: 1.4; margin-top: 20px;">This authorization token is active for 15 minutes. If you did not initiate this request, please disregard this email.</p>
        </div>
      `,
    });

    console.log(`[EMAIL DISPATCHED]: Password reset instructions sent to ${user.email}`);

    return res.status(200).json({
      success: true,
      message: `Password reset authorization dispatched to ${user.email}.`,
      data: {
        email: user.email,
        directLink: directResetLink,
      },
    });
  } catch (error) {
    console.error("Forgot Password Mail Error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to send authorization email. Please verify mailer settings.",
      error: error.message,
    });
  }
};

// @desc    Authorize and Set New Password (Accepts either 4-digit OTP OR Direct Link Token)
// @route   POST /api/v1/auth/reset-password
exports.resetPassword = async (req, res) => {
  try {
    const { identifier, email, otp, token, newPassword, password } = req.body;
    const finalPassword = newPassword || password;

    if (!finalPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide a new strong password.",
      });
    }

    let user = null;

    // 1. Authorization by Direct Link Token
    if (token) {
      const hashedToken = crypto.createHash("sha256").update(token.trim()).digest("hex");
      user = await User.findOne({
        resetPasswordLinkToken: hashedToken,
        resetPasswordExpire: { $gt: Date.now() },
      });
    }

    // 2. Authorization by 4-digit OTP code & Email/Identifier
    if (!user && otp) {
      const targetInput = String(email || identifier || "").trim().toLowerCase();
      user = await User.findOne({
        $or: [
          { email: new RegExp(`^${targetInput}$`, "i") },
          { phone: targetInput },
        ],
        resetPasswordToken: String(otp).trim(),
        resetPasswordExpire: { $gt: Date.now() },
      });
    }

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired authorization code/link. Please request a new one.",
      });
    }

    // Hash and update password securely
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(String(finalPassword), salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordLinkToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      success: true,
      message: "Password updated successfully. You can now login with your new password.",
    });
  } catch (error) {
    console.error("Reset Password Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reset security password.",
      error: error.message,
    });
  }
};

// =======================================
// AUTOMATED WALLET WEBHOOK (PAYSTACK / MONNIFY)
// =======================================
exports.paystackWebhook = async (req, res) => {
  try {
    const event = req.body;

    if (
      event.event === "charge.success" ||
      event.event === "dedicated_account.assign.success" ||
      event.eventType === "SUCCESSFUL_TRANSACTION"
    ) {
      const data = event.data || event.eventData || {};
      const customerEmail = String(data.customer?.email || data.customerEmail || "").toLowerCase().trim();
      const amountPaid = Number(data.amount || 0) / (event.event === "charge.success" ? 100 : 1);
      const reference = data.reference || data.transactionReference || `FUND-${Date.now()}`;

      const user = await User.findOne({
        $or: [
          { email: customerEmail },
          { phone: customerEmail.split("@")[0] }
        ]
      });

      if (user && amountPaid > 0) {
        const alreadyExists = await Transaction.findOne({ reference });
        if (!alreadyExists) {
          const previousBalance = Number(user.walletBalance || user.balance || 0);
          const newBalance = previousBalance + amountPaid;

          user.walletBalance = newBalance;
          user.balance = newBalance;
          await user.save({ validateBeforeSave: false });

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

          if (Notification) {
            await Notification.create({
              user: user._id,
              recipient: user._id,
              userId: user._id,
              title: "Wallet Credit Alert 💳",
              message: `Your wallet has been credited with ₦${amountPaid.toLocaleString()} via Automated Dedicated Transfer. New Balance: ₦${newBalance.toLocaleString()}.`,
              category: "PAYMENT_SUCCESS",
              isRead: false,
              read: false,
              status: "unread",
              createdAt: new Date(),
            });
          }
        }
      }
    }

    return res.status(200).json({ status: "success", message: "Webhook acknowledged" });
  } catch (error) {
    console.error("Webhook Error:", error);
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

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
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