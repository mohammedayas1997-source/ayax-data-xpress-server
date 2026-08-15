const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity"); // Don ganin ayyukan ma'aikata

// @desc    Get System Overview (Statistics)
exports.getSystemStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalAdmins = await User.countDocuments({ role: "admin" });
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
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get All Transactions in the System (Kowa da kowa)
exports.getAllGlobalTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate("user", "surname firstName email phone role")
      .sort({ createdAt: -1 })
      .limit(500); // Mun takaita don gudun nauyi

    res
      .status(200)
      .json({ success: true, count: transactions.length, data: transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get All Admin & Staff Activities (Ganin aikin kowane ma'aikaci)
exports.getAuditLogs = async (req, res) => {
  try {
    const logs = await Activity.find()
      .populate("staffId", "surname firstName role email")
      .populate("targetUser", "surname firstName role")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Change Any User Role (Superadmin can demote/promote anyone)
exports.manageUserRole = async (req, res) => {
  try {
    const { userId, newRole } = req.body;

    // Kare kai: Superadmin ba zai iya rage wa kansa matsayi ba ta nan
    if (userId === req.user.id && newRole !== "superadmin") {
      return res
        .status(400)
        .json({ success: false, message: "You cannot demote yourself!" });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { role: newRole },
      { new: true },
    ).select("-password");

    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    res.status(200).json({
      success: true,
      message: `User role updated to ${newRole}`,
      data: user,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a new Admin
exports.makeAdmin = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findByIdAndUpdate(
      userId,
      { role: "admin" },
      { new: true },
    );
    res
      .status(200)
      .json({ success: true, message: "User is now an Admin", data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Admin creates a new staff (supervisor or agent)
exports.createStaff = async (req, res) => {
  try {
    const { firstName, surname, email, password, phone, role } = req.body;

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
        message: "Invalid role specified.",
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
    });

    res.status(201).json({
      success: true,
      message: `${role.charAt(0).toUpperCase() + role.slice(1)} created successfully!`,
      data: {
        id: newStaff._id,
        name: newStaff.name,
        email: newStaff.email,
        role: newStaff.role,
      },
    });

  } catch (error) {
    console.error("Create Staff Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error while creating staff.",
    });
  }
};