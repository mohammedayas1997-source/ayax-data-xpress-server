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
// @desc    Authenticate Supervisor / Management & session initialization
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

    // Tsarin kwararru: Tabbatar cewa mai shiga nan yana da mukamin gudanarwa (Supervisor ko Superadmin)
    const allowedManagementRoles = ["supervisor", "superadmin"];
    
    if (!user || !(await user.matchPassword(password)) || !allowedManagementRoles.includes(user.role)) {
      return res.status(401).json({
        success: false,
        message: "Authentication failed: Unauthorized management parameters.",
      });
    }

    sendToken(user, 200, res);
  } catch (error) {
    console.error("Management Login Protocol Error:", error);
    res.status(500).json({
      success: false,
      message: "Authentication server error.",
    });
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
      const creditValue = amount / 100; // Akwai shi idan kana son amfani da shi wajen ƙarin kuɗi

      await User.findOneAndUpdate(
        { email: customerEmail },
        {
          $inc: {
            walletBalance: creditValue, // An gyara daga amount zuwa creditValue (Naira)
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
    });
  }
};

// =======================================
// UPDATE PASSWORD
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
    
    return res
      .status(200)
      .json({ success: true, message: "Security parameters updated." });
  } catch (error) {
    console.error("Update Password Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating password.",
    });
  }
};

// Update Transaction PIN Logic
exports.updatePin = async (req, res) => {
  try {
    const { newPin } = req.body;
    
    if (!newPin) {
      return res.status(400).json({
        success: false,
        message: "Please provide the new PIN.",
      });
    }

    await User.findByIdAndUpdate(req.user.id, { transactionPin: newPin });
    
    return res
      .status(200)
      .json({ success: true, message: "Transaction PIN synchronized." });
  } catch (error) {
    console.error("Update PIN Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating PIN.",
    });
  }
};