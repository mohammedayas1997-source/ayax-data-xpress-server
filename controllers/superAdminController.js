const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");

// @desc    Get System Overview (Statistics)
// @route   GET /api/v1/admin/stats
// @access  Private/Admin
exports.getSystemStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalAdmins = await User.countDocuments({ role: { $in: ["admin", "superadmin"] } });
    const totalSupervisors = await User.countDocuments({ role: "supervisor" });
    const totalAgents = await User.countDocuments({ role: "agent" });

    const stats = await Transaction.aggregate([
      { $match: { status: "success" } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        users: { totalUsers, totalAdmins, totalSupervisors, totalAgents },
        finance: {
          totalRevenue: stats[0] ? stats[0].totalRevenue : 0,
          successfulTransactions: stats[0] ? stats[0].count : 0,
        },
      },
    });
  } catch (error) {
    console.error("Get System Stats Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get All Transactions in the System (Global)
// @route   GET /api/v1/admin/transactions
// @access  Private/Admin
exports.getAllGlobalTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate("user", "surname firstName email phone role")
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    res.status(200).json({ 
      success: true, 
      count: transactions.length, 
      data: transactions 
    });
  } catch (error) {
    console.error("Get Global Transactions Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get All Admin & Staff Activities (Audit Logs)
// @route   GET /api/v1/admin/audit-logs
// @access  Private/Admin
exports.getAuditLogs = async (req, res) => {
  try {
    const logs = await Activity.find()
      .populate("staffId", "surname firstName role email")
      .populate("targetUser", "surname firstName role email")
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ 
      success: true, 
      count: logs.length, 
      data: logs 
    });
  } catch (error) {
    console.error("Get Audit Logs Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Change Any User Role
// @route   PATCH /api/v1/admin/manage-role
// @access  Private/Admin
exports.manageUserRole = async (req, res) => {
  try {
    const { userId, newRole } = req.body;

    if (!userId || !newRole) {
      return res.status(400).json({ success: false, message: "Please provide userId and newRole" });
    }

    // Kare kai: Superadmin ba zai iya rage wa kansa matsayi ba ta nan
    if (userId === req.user.id && newRole !== "superadmin" && newRole !== "admin") {
      return res
        .status(400)
        .json({ success: false, message: "You cannot demote yourself!" });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { role: newRole },
      { new: true },
    ).select("-password");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Rubuta Activity Log
    await Activity.create({
      staffId: req.user._id,
      action: "MANAGE_USER_ROLE",
      details: `Changed role for user ${user.name} (${user.email}) to ${newRole}`,
      targetUser: userId,
    });

    res.status(200).json({
      success: true,
      message: `User role updated to ${newRole}`,
      data: user,
    });
  } catch (error) {
    console.error("Manage User Role Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a new Admin
// @route   POST /api/v1/admin/make-admin
// @access  Private/Superadmin
exports.makeAdmin = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "Please provide userId" });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { role: "admin" },
      { new: true },
    ).select("-password");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Rubuta Activity Log
    await Activity.create({
      staffId: req.user._id,
      action: "MAKE_ADMIN",
      details: `Promoted user ${user.name} (${user.email}) to Admin`,
      targetUser: userId,
    });

    res.status(200).json({ 
      success: true, 
      message: "User is now an Admin", 
      data: user 
    });
  } catch (error) {
    console.error("Make Admin Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Admin creates a new staff (supervisor, agent, or admin)
// @route   POST /api/v1/admin/create-staff
// @access  Private/Admin
exports.createStaff = async (req, res) => {
  try {
    const { firstName, surname, email, password, phone, role, state, lga, address } = req.body;

    // 1. Tabbatar an cika duk bayanan da ake bukata
    if (!firstName || !surname || !email || !password || !phone || !role) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields: firstName, surname, email, password, phone, and role",
      });
    }

    // 2. Tabbatar idan role din da aka ba shi daidai ne
    const allowedRoles = ["supervisor", "agent", "admin"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role specified. Allowed roles: supervisor, agent, admin",
      });
    }

    // 3. Duba ko akwai wani mai amfani da wannan email din ko phone a baya
    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({
      $or: [{ email: normalizedEmail }, { phone: phone.trim() }],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "A user with this email or phone already exists.",
      });
    }

    // 4. Ƙirƙirar sabon staff
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

    // 5. Rubuta Activity Log
    await Activity.create({
      staffId: req.user._id,
      action: "CREATE_STAFF",
      details: `Created new ${role} account for ${newStaff.name} (${normalizedEmail})`,
      targetUser: newStaff._id,
    });

    res.status(201).json({
      success: true,
      message: `${role.charAt(0).toUpperCase() + role.slice(1)} created successfully!`,
      data: {
        id: newStaff._id,
        name: newStaff.name,
        email: newStaff.email,
        phone: newStaff.phone,
        role: newStaff.role,
      },
    });

  } catch (error) {
    console.error("Create Staff Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while creating staff.",
      error: error.message,
    });
  }
};