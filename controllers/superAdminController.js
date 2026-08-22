const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const DataPlan = require("../models/DataPlan");
const NIMCPrice = require("../models/NIMCPrice");
const BVNPrice = require("../models/BVNPrice");
const axios = require("axios");

const RAW_URL =
  process.env.AYAX_API_BASE_URL ||
  process.env.MARKETPLACE_API_URL ||
  "https://ayax-api-marketplace.onrender.com";
const CLEAN_BASE = RAW_URL.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
const AYAX_API_BASE_URL = `${CLEAN_BASE}/api/v1`;

const AYAX_API_KEY =
  process.env.AYAX_API_KEY ||
  process.env.MARKETPLACE_API_KEY ||
  "ayax_live_13e936ef28c32f2b9d99f2974949e411608490dc069de75ad06f165251eb5345";

const getMarketplaceHeaders = (authHeader) => ({
  "Content-Type": "application/json",
  "x-api-key": AYAX_API_KEY,
  Authorization: authHeader || (AYAX_API_KEY ? `Bearer ${AYAX_API_KEY}` : undefined),
});

const sendNotification = async (userId, title, message) => {
  try {
    const user = await User.findById(userId);
    if (user) {
      if (!user.notifications) user.notifications = [];
      user.notifications.push({ title, message, date: new Date(), isRead: false });
      await user.save();
    }
  } catch (err) {
    console.error("Notification Error:", err.message);
  }
};

// ==========================================
// 1. STATS & AUDIT LOGS
// ==========================================
exports.getSystemStats = async (req, res) => {
  try {
    const [totalUsers, totalAdmins, totalSupervisors, totalAgents] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: { $in: ["admin", "superadmin"] } }),
      User.countDocuments({ role: "supervisor" }),
      User.countDocuments({ role: "agent" }),
    ]);

    const stats = await Transaction.aggregate([
      { $match: { status: "success" } },
      { $group: { _id: null, totalRevenue: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]);

    res.status(200).json({
      success: true,
      data: {
        users: { totalUsers, totalAdmins, totalSupervisors, totalAgents },
        finance: {
          totalRevenue: stats[0]?.totalRevenue || 0,
          successfulTransactions: stats[0]?.count || 0,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAuditLogs = async (req, res) => {
  try {
    const logs = await Activity.find()
      .populate("staffId", "surname firstName role email name")
      .populate("targetUser", "surname firstName role email name")
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean();

    res.status(200).json({ success: true, count: logs.length, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. USER, STAFF & ROLE OVERRIDES
// ==========================================
exports.manageUserRole = async (req, res) => {
  try {
    const { userId, newRole } = req.body;
    if (!userId || !newRole) {
      return res.status(400).json({ success: false, message: "Provide userId and newRole" });
    }

    if (userId === String(req.user._id) && !["superadmin", "admin"].includes(newRole)) {
      return res.status(400).json({ success: false, message: "Cannot demote yourself!" });
    }

    const user = await User.findByIdAndUpdate(userId, { role: newRole }, { new: true }).select("-password");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    await Activity.create({
      staffId: req.user._id,
      action: "MANAGE_USER_ROLE",
      details: `Changed role for user ${user.name || user.email} to ${newRole}`,
      targetUser: userId,
    });

    res.status(200).json({ success: true, message: `Role updated to ${newRole}`, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.makeAdmin = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findByIdAndUpdate(userId, { role: "admin" }, { new: true }).select("-password");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    await Activity.create({
      staffId: req.user._id,
      action: "MAKE_ADMIN",
      details: `Promoted user ${user.name || user.email} to Admin`,
      targetUser: userId,
    });

    res.status(200).json({ success: true, message: "User is now an Admin", data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createStaff = async (req, res) => {
  try {
    const { firstName, surname, email, password, phone, role, state, lga, address } = req.body;
    if (!firstName || !surname || !email || !password || !phone || !role) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ $or: [{ email: normalizedEmail }, { phone: phone.trim() }] });
    if (existing) {
      return res.status(400).json({ success: false, message: "Email or phone already exists." });
    }

    const newStaff = await User.create({
      firstName: firstName.trim(),
      surname: surname.trim(),
      name: `${firstName} ${surname}`.trim(),
      email: normalizedEmail,
      phone: phone.trim(),
      password,
      role,
      state: state || "",
      lga: lga || "",
      address: address || "",
    });

    await Activity.create({
      staffId: req.user._id,
      action: "CREATE_STAFF",
      details: `Created new ${role} (${normalizedEmail})`,
      targetUser: newStaff._id,
    });

    res.status(201).json({ success: true, message: `${role} created successfully!`, data: newStaff });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 3. WALLET CREDIT / DEBIT OVERRIDES
// ==========================================
exports.creditUser = async (req, res) => {
  const { userId, amount, reason } = req.body;
  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const numAmt = Number(amount);
    user.walletBalance = (user.walletBalance || user.balance || 0) + numAmt;
    if (user.balance !== undefined) user.balance = user.walletBalance;

    if (!user.transactions) user.transactions = [];
    user.transactions.push({
      type: "credit",
      amount: numAmt,
      status: "success",
      description: `SuperAdmin Credit: ${reason || "Manual Funding"}`,
      date: new Date(),
    });
    await user.save();

    await Transaction.create({
      user: user._id,
      transactionId: `ADMCRD-${Date.now()}`,
      reference: `CRD-${Date.now()}`,
      type: "wallet_funding",
      amount: numAmt,
      status: "success",
      details: `SuperAdmin Credit: ${reason || "Manual Funding"}`,
      requestedBy: req.user._id,
    }).catch(() => {});

    await Activity.create({
      staffId: req.user._id,
      action: "USER_CREDITED",
      details: `Credited ₦${numAmt} to ${user.email}`,
      targetUser: user._id,
    });

    await sendNotification(user._id, "Wallet Credited", `Credited ₦${numAmt}. Reason: ${reason || "Manual Funding"}`);

    res.status(200).json({ success: true, message: `₦${numAmt} credited`, newBalance: user.walletBalance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.debitUser = async (req, res) => {
  const { userId, amount, reason } = req.body;
  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const currentBal = user.walletBalance || user.balance || 0;
    const numAmt = Number(amount);
    if (currentBal < numAmt) return res.status(400).json({ success: false, message: "Insufficient balance" });

    user.walletBalance = currentBal - numAmt;
    if (user.balance !== undefined) user.balance = user.walletBalance;

    if (!user.transactions) user.transactions = [];
    user.transactions.push({
      type: "debit",
      amount: numAmt,
      status: "success",
      description: `SuperAdmin Debit: ${reason || "Manual Deduction"}`,
      date: new Date(),
    });
    await user.save();

    await Activity.create({
      staffId: req.user._id,
      action: "USER_DEBITED",
      details: `Debited ₦${numAmt} from ${user.email}`,
      targetUser: user._id,
    });

    await sendNotification(user._id, "Wallet Debited", `Debited ₦${numAmt}. Reason: ${reason || "Administrative charge"}`);

    res.status(200).json({ success: true, message: `₦${numAmt} debited`, newBalance: user.walletBalance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 4. AUTOMATIC DATA DISPATCH (SINGLE / BULK / ALL)
// ==========================================
exports.dispatchData = async (req, res) => {
  try {
    const { network, planId, planCode, dataType = "SME", recipients, targetUserIds, sendToAllUsers = false } = req.body;

    if (!planId && !planCode) {
      return res.status(400).json({ success: false, message: "Provide a valid planId or planCode." });
    }

    const query = [];
    if (planId && typeof planId === "string" && planId.match(/^[0-9a-fA-F]{24}$/)) query.push({ _id: planId });
    if (planCode) query.push({ planCode: String(planCode) });
    if (planId) query.push({ planCode: String(planId) });

    const planDoc = await DataPlan.findOne({ $or: query });
    if (!planDoc) return res.status(404).json({ success: false, message: "Data plan not found." });

    let phoneList = [];
    if (sendToAllUsers) {
      const allUsers = await User.find({ role: "user", status: { $ne: "banned" } }).select("phone");
      phoneList = allUsers.map((u) => u.phone).filter(Boolean);
    } else if (Array.isArray(targetUserIds) && targetUserIds.length > 0) {
      const targetUsers = await User.find({ _id: { $in: targetUserIds } }).select("phone");
      phoneList = targetUsers.map((u) => u.phone).filter(Boolean);
    } else if (Array.isArray(recipients)) {
      phoneList = recipients.map((p) => String(p).trim()).filter(Boolean);
    } else if (typeof recipients === "string") {
      phoneList = recipients.split(/[\n,]+/).map((p) => p.trim()).filter((p) => p.length >= 11);
    }

    phoneList = [...new Set(phoneList)];
    if (phoneList.length === 0) {
      return res.status(400).json({ success: false, message: "No valid recipient phone numbers provided." });
    }

    const requestHeaders = getMarketplaceHeaders(req.headers.authorization);
    const results = { total: phoneList.length, successful: 0, failed: 0, details: [] };

    for (const phoneNumber of phoneList) {
      const reference = `SUPER-DISP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const requestPayload = {
        network: planDoc.networkName || String(network || "MTN").toUpperCase(),
        networkId: planDoc.networkId || "01",
        plan: planDoc.planCode,
        planId: planDoc.planCode,
        planCode: planDoc.planCode,
        planSize: planDoc.planLabel,
        sizeGB: planDoc.sizeGB || 1,
        dataType: planDoc.planType || dataType,
        phone: phoneNumber,
        phoneNumber: phoneNumber,
        amount: 0,
        ref_id: reference,
        reference,
      };

      try {
        const response = await axios.post(`${AYAX_API_BASE_URL}/data/buy`, requestPayload, {
          headers: requestHeaders,
          timeout: 35000,
        });

        const resData = response.data;
        if (resData?.status === true || resData?.status === "success" || resData?.code === 200 || resData?.success === true) {
          results.successful += 1;
          results.details.push({ phone: phoneNumber, status: "SUCCESS", reference });

          await Transaction.create({
            user: req.user._id,
            transactionId: `ADM${Date.now()}${Math.floor(Math.random() * 100)}`,
            reference,
            type: "data",
            amount: 0,
            phoneNumber,
            provider: planDoc.networkName,
            status: "success",
            details: `SuperAdmin Dispatch: ${planDoc.planLabel} to ${phoneNumber}`,
            requestedBy: req.user._id,
          }).catch(() => {});
        } else {
          results.failed += 1;
          results.details.push({ phone: phoneNumber, status: "FAILED", reason: resData?.message || "Gateway declined" });
        }
      } catch (err) {
        results.failed += 1;
        results.details.push({ phone: phoneNumber, status: "FAILED", reason: err.response?.data?.message || err.message });
      }
    }

    await Activity.create({
      staffId: req.user._id,
      action: "SUPERADMIN_DATA_DISPATCH",
      details: `Dispatched ${planDoc.planLabel} to ${results.successful}/${results.total} recipients`,
      targetUser: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: `Dispatch complete: ${results.successful} Success, ${results.failed} Failed`,
      results,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};