const User = require("../models/User");
const TargetHistory = require("../models/TargetHistory");
const Activity = require("../models/Activity");
const Transaction = require("../models/Transaction");
const { NIGERIA_STATES_LGAS, ALL_NIGERIAN_STATES } = require("../utils/nigeriaGeoData");

// @desc    National Field Overview (Dukkan Jihohi 36 + FCT, Managers, Supervisors, Agents, da Sales Volume)
exports.getSuperLeaderDashboard = async (req, res) => {
  try {
    // 1. Nemo dukkan State Managers (SM)
    const stateManagers = await User.find({
      role: { $in: ["state_manager", "leader"] },
    }).lean();

    // 2. Jimillar Supervisors da Agents na Kasa baki daya
    const [totalSupervisors, totalAgents] = await Promise.all([
      User.countDocuments({ role: { $in: ["supervisor", "field_supervisor"] } }),
      User.countDocuments({ role: "agent" }),
    ]);

    // 3. Kididdige kowace Jiha a Matrix
    const statesMatrix = await Promise.all(
      ALL_NIGERIAN_STATES.map(async (stateName) => {
        const manager = stateManagers.find(
          (m) => m.state && m.state.toLowerCase() === stateName.toLowerCase()
        );

        const supsCount = await User.countDocuments({
          role: { $in: ["supervisor", "field_supervisor"] },
          state: stateName,
        });

        const agsCount = await User.countDocuments({
          role: "agent",
          state: stateName,
        });

        const lgasCount = NIGERIA_STATES_LGAS[stateName]?.length || 0;

        // Binciko jimillar cinikin Data na wannan Jihar
        let stateVolume = 0;
        try {
          if (Transaction) {
            const stateUsers = await User.find({ state: stateName }).select("_id").lean();
            const userIds = stateUsers.map((u) => u._id);

            const salesAgg = await Transaction.aggregate([
              {
                $match: {
                  user: { $in: userIds },
                  status: { $in: ["successful", "success", "completed"] },
                  type: { $in: ["data", "DATA"] },
                },
              },
              {
                $group: {
                  _id: null,
                  totalVolume: { $sum: { $ifNull: ["$dataSize", "$volume", "$amount"] } },
                },
              },
            ]);
            stateVolume = salesAgg[0]?.totalVolume || 0;
          }
        } catch (e) {
          stateVolume = manager?.walletBalance || 0;
        }

        return {
          state: stateName,
          lgasTotal: lgasCount,
          hasLeader: Boolean(manager),
          leaderId: manager?._id || null,
          leaderName: manager?.name || `${manager?.firstName || ""} ${manager?.surname || ""}`.trim() || "Vacant",
          leaderPhone: manager?.phone || "N/A",
          leaderEmail: manager?.email || "N/A",
          isSuspended: manager?.isSuspended || false,
          supervisorsCount: supsCount,
          agentsCount: agsCount,
          targetMonth: manager?.targets?.currentMonth || "August 2026",
          stateDataGoal: manager?.targets?.dataGoal || 5000,
          stateSupervisorGoal: manager?.targets?.supervisorGoal || lgasCount,
          stateVolumeSold: stateVolume,
        };
      })
    );

    const nationalVolumeSold = statesMatrix.reduce((acc, curr) => acc + (curr.stateVolumeSold || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        nationalStats: {
          totalStates: ALL_NIGERIAN_STATES.length,
          activeManagers: stateManagers.length,
          totalSupervisors,
          totalAgents,
          nationalVolumeSold,
        },
        statesMatrix,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    NSD Toggles Suspension for State Managers ko Supervisors (Suspend / Unsuspend)
exports.toggleStaffSuspension = async (req, res) => {
  try {
    const staffId = req.params.staffId || req.params.id || req.body.staffId;

    if (!staffId) {
      return res.status(400).json({ success: false, message: "Staff ID is required" });
    }

    const staff = await User.findById(staffId);
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff account not found" });
    }

    // Kada NSD ya dakatar da kansa ko babban SuperAdmin
    if (staff.role === "superadmin" || staff._id.toString() === req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "You cannot change suspension status for this executive account",
      });
    }

    staff.isSuspended = !staff.isSuspended;
    await staff.save();

    const actionType = staff.isSuspended ? "STAFF_SUSPENDED" : "STAFF_UNSUSPENDED";
    const statusText = staff.isSuspended ? "SUSPENDED" : "ACTIVATED";

    // Rubuta Activity Log
    await Activity.create({
      staffId: req.user._id,
      action: actionType,
      details: `NSD changed operational status for ${staff.name} (${staff.role.toUpperCase()} - ${staff.state || "National"}) to ${statusText}`,
      targetUser: staff._id,
    });

    res.status(200).json({
      success: true,
      message: `${staff.name} is now ${statusText}`,
      isSuspended: staff.isSuspended,
      data: staff,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    NSD Assigns State Target ga State Manager (SM)
exports.assignStateLeaderTarget = async (req, res) => {
  try {
    const { leaderId, dataGoal, supervisorGoal, month, state } = req.body;

    if (!leaderId) {
      return res.status(400).json({ success: false, message: "Please provide leaderId / manager ID" });
    }

    const manager = await User.findOne({
      _id: leaderId,
      role: { $in: ["state_manager", "leader"] },
    });

    if (!manager) {
      return res.status(404).json({ success: false, message: "State Manager not found" });
    }

    const targetMonth = month || new Date().toLocaleString("en-US", { month: "long", year: "numeric" });

    manager.targets = {
      dataGoal: Number(dataGoal) || 5000,
      supervisorGoal: Number(supervisorGoal) || 10,
      currentMonth: targetMonth,
      state: state || manager.state,
      assignedByNsd: req.user._id,
    };

    manager.markModified("targets");
    await manager.save();

    await TargetHistory.create({
      assignedTo: leaderId,
      assignedBy: req.user._id,
      dataGoal: Number(dataGoal) || 0,
      supervisorGoal: Number(supervisorGoal) || 0,
      month: targetMonth,
      state: state || manager.state,
    });

    await Activity.create({
      staffId: req.user._id,
      action: "STATE_TARGET_DEPLOYED",
      details: `NSD allocated ${dataGoal} GB & ${supervisorGoal} Supervisors quota to ${manager.name} (${manager.state} State) for ${targetMonth}`,
      targetUser: leaderId,
    });

    res.status(200).json({
      success: true,
      message: `State Target successfully deployed to ${manager.state} State Manager`,
      targets: manager.targets,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    NSD Appoints a New State Manager (SM)
exports.appointStateLeader = async (req, res) => {
  try {
    const { name, phone, email, state, password } = req.body;

    if (!phone || !state || !name) {
      return res.status(400).json({
        success: false,
        message: "State Manager Name, Phone Number, and State are required",
      });
    }

    const cleanPhone = phone.trim();
    const cleanState = state.trim();
    const cleanEmail = email
      ? email.toLowerCase().trim()
      : `${cleanState.toLowerCase().replace(/\s+/g, "")}.sm@ayaxdata.online`;

    const existingUser = await User.findOne({
      $or: [{ phone: cleanPhone }, { email: cleanEmail }],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "A staff account with this phone number or email already exists",
      });
    }

    const names = name.trim().split(" ");
    const firstName = names[0] || "State";
    const surname = names.slice(1).join(" ") || "Manager";

    const newManager = await User.create({
      firstName,
      surname,
      name: name.toUpperCase().trim(),
      email: cleanEmail,
      phone: cleanPhone,
      password: password || "Password123@",
      pin: "2026",
      transactionPin: "2026",
      role: "state_manager",
      state: cleanState,
      walletBalance: 250000,
      balance: 250000,
      isSuspended: false,
      isVerified: true,
      status: "active",
      assignedLeader: req.user._id,
    });

    await Activity.create({
      staffId: req.user._id,
      action: "STATE_MANAGER_APPOINTED",
      details: `NSD officially appointed ${newManager.name} as State Manager (SM) for ${cleanState} State`,
      targetUser: newManager._id,
    });

    res.status(201).json({
      success: true,
      message: `State Manager for ${cleanState} successfully appointed`,
      data: newManager,
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// @desc    Download 36 States Executive Report as CSV
exports.downloadNationalReport = async (req, res) => {
  try {
    const managers = await User.find({
      role: { $in: ["state_manager", "leader"] },
    }).lean();

    let csvHeader = "State,Manager Name,Phone,Email,Data Goal (GB),Supervisor Goal,Status\n";
    let csvRows = managers
      .map((m) => {
        const tg = m.targets || {};
        return `"${m.state || "N/A"}","${m.name || m.phone}","${m.phone}","${m.email}",${tg.dataGoal || 0},${tg.supervisorGoal || 0},"${m.isSuspended ? "Suspended" : "Active"}"`;
      })
      .join("\n");

    const csvData = csvHeader + csvRows;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=National-Sales-Director-36States-Report.csv`);
    return res.status(200).send(csvData);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};