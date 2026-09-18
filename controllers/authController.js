const User = require("../models/User");
const Transaction = require("../models/Transaction");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { Resend } = require("resend");

const resendApiKey = process.env.RESEND_API_KEY || "";
const resend = resendApiKey ? new Resend(resendApiKey) : null;

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

    default:
      return {
        title: "Welcome to Ayax Data Xpress 🚀",
        message: `Welcome, ${name}! Your digital wallet and service portal are fully operational. Enjoy instant, automated delivery for ultra-cheap Data, VTU Airtime, Utility bills, and Identity verification 24/7. Fund your wallet to get started!`,
        category: "WELCOME",
      };
  }
};

// HELPER: SEND JWT TOKEN
const sendToken = (user, statusCode, res) => {
  const userEmail = String(user.email || "").toLowerCase().trim();
  const userPhone = String(user.phone || "").trim();

  // Superadmin Account
  const isSuperAdmin =
    userPhone === "09033738409" ||
    userEmail === "mohammed.ayas@ayaxdata.online";

  // Operations Admin Account
  const isOperationsAdmin =
    userEmail === "mohammed@ayaxdata.online" ||
    userEmail === "admin@ayaxdata.online" ||
    userPhone === "08011112222";

  // Customer Support Desk Account
  const isSupport =
    userEmail === "support@ayaxdata.online" ||
    userPhone === "08077778888" ||
    userPhone === "09033738400";

  let effectiveRole = user.role || "user";
  if (isSuperAdmin) effectiveRole = "superadmin";
  else if (isOperationsAdmin && effectiveRole !== "superadmin") effectiveRole = "admin";
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

  let userPhone = String(user.phone || "").replace(/[^0-9]/g, "").trim();
  if (!userPhone || userPhone.length < 10) {
    userPhone = "09033738409";
  } else if (userPhone.length === 10) {
    userPhone = `0${userPhone}`;
  }

  const firstName = user.firstName || (user.name ? user.name.split(" ")[0] : "Customer");
  const surname = user.surname || (user.name && user.name.split(" ")[1] ? user.name.split(" ")[1] : "Ayax");

  const customerResponse = await axios.post(
    "https://api.paystack.co/customer",
    {
      email: user.email,
      first_name: firstName,
      last_name: surname,
      phone: userPhone,
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
      bankName: bankData.bank?.name || "Wema Bank",
      accountNumber: bankData.account_number,
      accountName: bankData.account_name || `${firstName} ${surname}`,
      virtualAccount: {
        bankName: bankData.bank?.name || "Wema Bank",
        accountNumber: bankData.account_number,
        accountName: bankData.account_name || `${firstName} ${surname}`,
      },
    },
    { new: true }
  );
};

// Helper: Tsaftace lambobin waya daban-daban don tantance asusu ba tare da kuskure ba
const extractPhoneVariants = (input = "") => {
  const raw = String(input).trim();
  const digits = raw.replace(/\D/g, "");
  const variants = [raw, raw.toLowerCase()];

  if (digits.length >= 7) {
    variants.push(digits);
    const last10 = digits.slice(-10);
    variants.push(last10);
    variants.push(`0${last10}`);
    variants.push(`234${last10}`);
    variants.push(`+234${last10}`);
  }
  return [...new Set(variants)];
};

// @desc    Register / Signup User or Agent or Supervisor
// @route   POST /api/v1/auth/register
exports.register = async (req, res) => {
  try {
    const {
      firstName,
      surname,
      otherName,
      name,
      fullName: reqFullName,
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

    const rawFullName = String(reqFullName || name || "").trim();
    if (!phone || (!firstName && !rawFullName)) {
      return res.status(400).json({
        success: false,
        message: "First Name (or Full Name) and Phone Number are required.",
      });
    }

    const cleanPhone = String(phone).replace(/[^0-9+]/g, "").trim();
    const cleanEmail = email
      ? String(email).toLowerCase().trim()
      : `${cleanPhone.replace(/[^0-9]/g, "")}@ayaxdata.online`;

    let existingUser = await User.findOne({
      $or: [
        { phone: cleanPhone },
        { phone: cleanPhone.replace(/[^0-9]/g, "") },
        { email: cleanEmail }
      ],
    }).lean();

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "An account with this phone number or email already exists.",
      });
    }

    const activeRef = String(referralCode || referredBy || supervisorId || "").trim();
    let assignedSupId = null;
    let assignedSupName = null;
    
    let finalState = state ? String(state).trim() : "";
    let finalLga = lga ? String(lga).trim() : "";

    if (activeRef) {
      const phoneDigits = activeRef.replace(/[^0-9]/g, "");
      const supervisor = await User.findOne({
        $or: [
          { referralCode: activeRef },
          { referralId: activeRef.toUpperCase() },
          ...(phoneDigits.length >= 10 ? [{ phone: phoneDigits }, { phone: `0${phoneDigits.slice(-10)}` }] : []),
        ],
      }).lean();

      if (supervisor) {
        assignedSupId = supervisor._id;
        assignedSupName = supervisor.name || `${supervisor.firstName || ""} ${supervisor.surname || ""}`.trim();
        if (!finalState) finalState = supervisor.state || "";
        if (!finalLga) finalLga = supervisor.lga || "";
      }
    }

    if (!assignedSupId && finalLga && finalState) {
      const lgaSupervisor = await User.findOne({
        role: { $in: ["supervisor", "field_supervisor"] },
        lga: new RegExp(`^${finalLga}$`, "i"),
        state: new RegExp(`^${finalState}$`, "i"),
      }).lean();

      if (lgaSupervisor) {
        assignedSupId = lgaSupervisor._id;
        assignedSupName = lgaSupervisor.name || `${lgaSupervisor.firstName || ""} ${lgaSupervisor.surname || ""}`.trim();
      }
    }

    const nameParts = rawFullName.split(/\s+/).filter(Boolean);
    const first = firstName ? String(firstName).trim() : (nameParts[0] || "User");
    let sur = surname ? String(surname).trim() : "";

    if (!sur) {
      sur = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "Ayax";
    }

    const finalFullName = rawFullName || `${first} ${sur}`.trim();

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password || "Password123@", salt);

    let finalRole = "user";
    const requestedRole = String(role || "").toLowerCase().trim();

    if (requestedRole === "supervisor" || requestedRole === "field_supervisor") {
      finalRole = "supervisor";
    } else if (requestedRole === "agent" || (!requestedRole && activeRef)) {
      finalRole = "agent";
    } else if (requestedRole) {
      finalRole = requestedRole;
    }

    const newUser = await User.create({
      firstName: first,
      surname: sur,
      otherName: otherName || "",
      name: finalFullName.toUpperCase().trim(),
      email: cleanEmail,
      phone: cleanPhone,
      password: hashedPassword,
      pin: "2026",
      transactionPin: "2026",
      role: finalRole,
      state: finalState,
      lga: finalLga,
      address: address ? String(address).trim() : "",
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
        currentMonth: "September 2026",
      },
    });

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
      Notification.create({
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
        Activity.create({
          staffId: assignedSupId,
          user: assignedSupId,
          lga: finalLga,
          state: finalState,
          action: finalRole === "supervisor" ? "SUPERVISOR_APPOINTED" : "AGENT_REGISTERED",
          details: `${finalRole.toUpperCase()} ${newUser.name} (${cleanPhone}) registered in ${finalLga} LGA, ${finalState}.`,
          targetUser: newUser._id,
        }).catch(() => {});
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

// @desc Universal Login Protocol (Tare da cikakken gyaran shiga na Jihar Kano da sauran jihohi)
exports.login = async (req, res) => {
  try {
    const { identifier, email, phone, username, password } = req.body;
    const rawInput = String(identifier || email || phone || username || "").trim();

    if (!rawInput || !password) {
      return res.status(400).json({
        success: false,
        message: "Please enter your Email/Phone and Password.",
      });
    }

    const cleanInput = rawInput.trim();
    const cleanEmail = cleanInput.toLowerCase();
    const cleanEnteredPassword = String(password).trim();

    // 1. SUPERADMIN MASTER BYPASS
    const isSuperAdmin =
      cleanEmail === "mohammed.ayas@ayaxdata.online" ||
      cleanInput === "09033738409" ||
      cleanInput === "+2349033738409";

    // 2. OPERATIONS ADMIN MASTER BYPASS
    const isOperationsAdmin =
      cleanEmail === "mohammed@ayaxdata.online" ||
      cleanEmail === "admin@ayaxdata.online" ||
      cleanInput === "08011112222" ||
      cleanInput === "+2348011112222";

    // 3. SUPPORT DESK MASTER BYPASS
    const isSupportDesk =
      cleanEmail === "support@ayaxdata.online" ||
      cleanInput === "08077778888" ||
      cleanInput === "09033738400" ||
      cleanInput === "+2348077778888";

    const isMasterPass =
      cleanEnteredPassword === "Password123@" ||
      cleanEnteredPassword === "Ayax@2026" ||
      cleanEnteredPassword === "admin123" ||
      cleanEnteredPassword === "Ayax@12345";

    // A. SuperAdmin Login Bypass
    if (isSuperAdmin && isMasterPass) {
      let superUser = await User.findOne({
        $or: [
          { email: "mohammed.ayas@ayaxdata.online" },
          { phone: "09033738409" },
        ],
      }).select("+password +pin +transactionPin");

      if (!superUser) {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(cleanEnteredPassword, salt);
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
      } else if (superUser.role !== "superadmin" || superUser.isSuspended) {
        superUser.role = "superadmin";
        superUser.isSuspended = false;
        await superUser.save({ validateBeforeSave: false });
      }

      return sendToken(superUser, 200, res);
    }

    // B. Operations Admin Login Bypass
    if (isOperationsAdmin && isMasterPass) {
      let adminUser = await User.findOne({
        $or: [
          { email: "mohammed@ayaxdata.online" },
          { email: "admin@ayaxdata.online" },
          { phone: "08011112222" },
        ],
      }).select("+password +pin +transactionPin");

      if (!adminUser) {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(cleanEnteredPassword, salt);
        adminUser = await User.create({
          firstName: "Mohammed",
          surname: "Admin",
          name: "MOHAMMED OPERATIONS",
          email: cleanEmail.includes("mohammed") ? "mohammed@ayaxdata.online" : "admin@ayaxdata.online",
          phone: "08011112222",
          password: hashedPassword,
          role: "admin",
          walletBalance: 250000,
          balance: 250000,
          pin: "2026",
          transactionPin: "2026",
          isSuspended: false,
          isVerified: true,
          status: "active",
        });
      } else if (adminUser.role !== "admin" || adminUser.isSuspended) {
        adminUser.role = "admin";
        adminUser.isSuspended = false;
        await adminUser.save({ validateBeforeSave: false });
      }

      return sendToken(adminUser, 200, res);
    }

    // C. Support Desk Login Bypass
    if (isSupportDesk && isMasterPass) {
      let supportUser = await User.findOne({
        $or: [
          { email: "support@ayaxdata.online" },
          { phone: "08077778888" },
          { phone: "09033738400" },
        ],
      }).select("+password +pin +transactionPin");

      if (!supportUser) {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(cleanEnteredPassword, salt);
        supportUser = await User.create({
          firstName: "Customer",
          surname: "Support",
          name: "CUSTOMER SUPPORT",
          email: "support@ayaxdata.online",
          phone: "08077778888",
          password: hashedPassword,
          role: "support",
          walletBalance: 50000,
          balance: 50000,
          pin: "2026",
          transactionPin: "2026",
          isSuspended: false,
          isVerified: true,
          status: "active",
        });
      } else if (supportUser.role !== "support" || supportUser.isSuspended) {
        supportUser.role = "support";
        supportUser.isSuspended = false;
        await supportUser.save({ validateBeforeSave: false });
      }

      return sendToken(supportUser, 200, res);
    }

    // 4. COMPREHENSIVE PHONE & EMAIL NORMALIZATION LOOKUP
    const phoneVariants = extractPhoneVariants(cleanInput);

    const user = await User.findOne({
      $or: [
        { email: cleanEmail },
        { email: cleanInput },
        { username: cleanInput },
        { username: cleanEmail },
        { phone: { $in: phoneVariants } },
        { email: new RegExp(`^${cleanEmail}$`, "i") },
      ],
    }).select("+password +pin +transactionPin");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials: User account not found.",
      });
    }

    // 5. CHECK ACCOUNT SUSPENSION
    if (user.isSuspended && !isSuperAdmin && !isOperationsAdmin && !isSupportDesk) {
      return res.status(403).json({
        success: false,
        message: "Account suspended. Please contact customer support.",
      });
    }

    // 6. ENHANCED MULTI-TIER PASSWORD VERIFICATION (WITH KANO AUTOCORRECTION)
    let isMatch = false;
    const storedHash = String(user.password || "");

    // A. Bcrypt Compare
    if (storedHash) {
      try {
        isMatch = await bcrypt.compare(cleanEnteredPassword, storedHash);
      } catch (e) {
        isMatch = false;
      }
    }

    // B. Schema matchPassword method fallback
    if (!isMatch && typeof user.matchPassword === "function") {
      try {
        isMatch = await user.matchPassword(cleanEnteredPassword);
      } catch (e) {
        isMatch = false;
      }
    }

    // C. Plain Text Matching Fallback (Idan an ajiye shi a fili a baya)
    if (!isMatch && storedHash && storedHash === cleanEnteredPassword) {
      isMatch = true;
    }

    // D. Jihar Kano & Master Resets Autocorrection Bypass
    const isKanoUser = String(user.state || "").trim().toLowerCase() === "kano";
    const isAcceptedSpecialPass =
      cleanEnteredPassword === "Password123@" ||
      cleanEnteredPassword === "Ayax@12345" ||
      cleanEnteredPassword === "Ibrahim@12345" ||
      cleanEnteredPassword.toLowerCase() === "ibrahim@12345" ||
      cleanEnteredPassword === "Bello6770@" ||
      cleanEnteredPassword === "Ayax@2026";

    if (!isMatch && (isKanoUser || isAcceptedSpecialPass)) {
      if (
        isAcceptedSpecialPass ||
        storedHash === cleanEnteredPassword ||
        storedHash.includes("Password123@") ||
        storedHash.includes("Ayax@12345")
      ) {
        isMatch = true;
      }
    }

    // Idan an samu match ta wata hanya, gyara password din ya zama standard hash a database
    if (isMatch && (!storedHash.startsWith("$2") || storedHash === cleanEnteredPassword)) {
      try {
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(cleanEnteredPassword, salt);
        await user.save({ validateBeforeSave: false });
      } catch (_) {}
    }

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials: Incorrect password.",
      });
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
    const phoneVariants = extractPhoneVariants(rawInput);

    const user = await User.findOne({
      $or: [
        { email: cleanInput },
        { phone: { $in: phoneVariants } },
      ],
    });

    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If an account matches this identity, password reset instructions have been dispatched.",
      });
    }

    const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
    const resetToken = crypto.randomBytes(24).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

    user.resetPasswordToken = otpCode;
    user.resetPasswordLinkToken = tokenHash;
    user.resetPasswordExpire = Date.now() + 15 * 60 * 1000;
    await user.save({ validateBeforeSave: false });

    const serverOrigin = process.env.CLIENT_URL || "https://ayaxdata.online";
    const directResetLink = `${serverOrigin}/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`;

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; padding: 24px; max-width: 520px; margin: auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #0284c7; margin: 0; font-size: 22px;">Ayax Data Xpress</h2>
          <p style="color: #64748b; font-size: 13px; margin-top: 4px;">Security & Password Authorization</p>
        </div>
        
        <p style="color: #334155; font-size: 14px;">Hello <strong>${user.firstName || user.name || "Customer"}</strong>,</p>
        <p style="color: #475569; font-size: 13px; line-height: 1.5;">Your 4-digit password reset OTP is:</p>

        <div style="background-color: #f0f9ff; border: 1px dashed #0284c7; padding: 14px; text-align: center; font-size: 26px; font-weight: 900; color: #0369a1; letter-spacing: 6px; border-radius: 8px; margin: 18px 0;">
          ${otpCode}
        </div>

        <div style="text-align: center; margin: 24px 0;">
          <a href="${directResetLink}" style="background-color: #0284c7; color: #ffffff; text-decoration: none; padding: 12px 24px; font-size: 13px; font-weight: bold; border-radius: 8px; display: inline-block;">
            DIRECT ONE-CLICK PASSWORD RESET
          </a>
        </div>

        <p style="color: #94a3b8; font-size: 11.5px; line-height: 1.4; margin-top: 20px;">This authorization token expires in 15 minutes.</p>
      </div>
    `;

    let emailDispatched = false;

    if (resend) {
      resend.emails
        .send({
          from: process.env.EMAIL_FROM || "Ayax Data Xpress <onboarding@resend.dev>",
          to: user.email,
          subject: "Password Reset Authorization - Ayax Data Xpress",
          html: emailHtml,
        })
        .catch((err) => {
          console.error("Resend API Error:", err.message);
        });
      emailDispatched = true;
    }

    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    if (!emailDispatched && emailUser && emailPass) {
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        auth: {
          user: emailUser,
          pass: emailPass.replace(/\s+/g, ""),
        },
        tls: {
          rejectUnauthorized: false,
        },
        connectionTimeout: 5000,
      });

      transporter
        .sendMail({
          from: `"Ayax Data Xpress" <${emailUser}>`,
          to: user.email,
          subject: "Password Reset Authorization - Ayax Data Xpress",
          html: emailHtml,
        })
        .catch((err) => console.error("SMTP Dispatch Error:", err.message));
    }

    return res.status(200).json({
      success: true,
      message: `Password reset OTP has been dispatched to ${user.email}.`,
      data: {
        email: user.email,
        directLink: directResetLink,
      },
    });
  } catch (error) {
    console.error("Forgot Password Error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to process password reset request.",
      error: error.message,
    });
  }
};

// @desc    Authorize and Set New Password
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

    if (token) {
      const hashedToken = crypto.createHash("sha256").update(token.trim()).digest("hex");
      user = await User.findOne({
        resetPasswordLinkToken: hashedToken,
        resetPasswordExpire: { $gt: Date.now() },
      });
    }

    if (!user && otp) {
      const targetInput = String(email || identifier || "").trim().toLowerCase();
      const phoneVariants = extractPhoneVariants(targetInput);
      user = await User.findOne({
        $or: [
          { email: targetInput },
          { phone: { $in: phoneVariants } },
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
        const alreadyExists = await Transaction.findOne({ reference }).lean();
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
            Notification.create({
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
            }).catch(() => {});
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
// UPDATE PASSWORD & PIN (GYARAN DUKKAN KOFIFIN PIN)
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
      try {
        isMatch = await bcrypt.compare(currentPassword, user.password);
      } catch (_) {}
    }
    if (!isMatch && user.password === currentPassword) {
      isMatch = true;
    }

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Security check failed: Current password incorrect.",
      });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save({ validateBeforeSave: false });

    return res.status(200).json({ success: true, message: "Password updated successfully." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// CREATE PIN (GA WANDA BAI DA SHI KO SAKE SAITAWA)
exports.createPin = async (req, res) => {
  try {
    const pinToUse = req.body.newPin || req.body.pin || req.body.transactionPin;

    if (!pinToUse || String(pinToUse).length !== 4) {
      return res.status(400).json({
        success: false,
        message: "Valid 4-digit PIN required.",
      });
    }

    const userId = req.user?._id || req.user?.id || req.body.userId;
    const user = await User.findById(userId).select("+password");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    // Idan an tura password, tabbatar dashi
    const enteredPassword = req.body.password || req.body.accountPassword || req.body.currentPassword;
    if (enteredPassword && user.password) {
      let isMatch = false;
      try {
        isMatch = await bcrypt.compare(String(enteredPassword).trim(), user.password);
      } catch (_) {}
      if (!isMatch && typeof user.matchPassword === "function") {
        try { isMatch = await user.matchPassword(String(enteredPassword).trim()); } catch (_) {}
      }
      if (!isMatch && (user.password === enteredPassword || enteredPassword === "Password123@" || enteredPassword === "Ayax@12345")) {
        isMatch = true;
      }
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: "Incorrect account password. Authorization failed.",
        });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPin = await bcrypt.hash(String(pinToUse), salt);

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

// UPDATE PIN (CIKAKKEN GYARAN DA KE HANA KUSKUREN "PIN Error: Please provide your account password...")
exports.updatePin = async (req, res) => {
  try {
    const password = req.body.password || req.body.accountPassword || req.body.currentPassword;
    const pinToUse = req.body.newPin || req.body.pin || req.body.transactionPin;

    if (!pinToUse || String(pinToUse).length !== 4) {
      return res.status(400).json({
        success: false,
        message: "Transaction PIN must be exactly 4 digits.",
      });
    }

    const userId = req.user?._id || req.user?.id || req.body.userId;
    const user = await User.findById(userId).select("+password");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    // Duba ko asusun nada password ajiye a DB
    if (password && user.password) {
      let isPasswordMatch = false;
      try {
        isPasswordMatch = await bcrypt.compare(String(password).trim(), user.password);
      } catch (_) {}
      if (!isPasswordMatch && typeof user.matchPassword === "function") {
        try { isPasswordMatch = await user.matchPassword(String(password).trim()); } catch (_) {}
      }
      if (!isPasswordMatch && (user.password === password || password === "Password123@" || password === "Ayax@12345")) {
        isPasswordMatch = true;
      }

      if (!isPasswordMatch) {
        return res.status(401).json({
          success: false,
          message: "Incorrect account password. Authorization failed.",
        });
      }
    } else if (!password && user.password && user.transactionPin && user.transactionPin !== "0000") {
      // Idan asusun yana da PIN a baya amma ba a tura password ba
      return res.status(400).json({
        success: false,
        message: "Please provide your account password and the new PIN.",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPin = await bcrypt.hash(String(pinToUse), salt);

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

// POST /api/v1/auth/generate-virtual-account
exports.generateVirtualAccount = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id || req.body.userId;
    let user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const updatedUser = await createDedicatedAccount(user);

    return res.status(200).json({
      success: true,
      message: "Virtual account generated successfully.",
      bankName: updatedUser.bankName,
      accountNumber: updatedUser.accountNumber,
      accountName: updatedUser.accountName,
    });
  } catch (error) {
    console.error("Dedicated Account Error:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: error.response?.data?.message || "Could not generate virtual account. Please try again later.",
    });
  }
};