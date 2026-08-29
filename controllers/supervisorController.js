const User = require("../models/User");
const Activity = require("../models/Activity");
const mongoose = require("mongoose");

let Sale;
try {
  Sale = require("../models/Sale");
} catch (e) {
  Sale = null;
}

let Transaction;
try {
  Transaction = require("../models/Transaction");
} catch (e) {
  Transaction = null;
}

/**
 * @desc    Get Supervisor Dashboard Real-Time Telemetry
 * @route   GET /api/v1/supervisor/dashboard
 * @access  Private (Supervisor)
 */
exports.getSupervisorDashboard = async (req, res) => {
  try {
    const supervisorId = req.user._id || req.user?.id;
    const supervisor = await User.findById(supervisorId).select("-password").lean();

    if (!supervisor) {
      return res.status(404).json({ success: false, message: "Supervisor profile not found" });
    }

    const myLga = supervisor.lga || "Ajingi";
    const myState = supervisor.state || "Kano";

    const agents = await User.find({
      role: "agent",
      $or: [
        { assignedSupervisor: supervisorId },
        { lga: new RegExp(`^${myLga.trim()}$`, "i"), state: new RegExp(`^${myState.trim()}$`, "i") },
      ],
    })
      .select("-password -pin -transactionPin")
      .sort({ createdAt: -1 })
      .lean();

    let totalTeamDataSold = 0;
    let totalTeamAirtimeSold = 0;

    const formattedAgents = await Promise.all(
      agents.map(async (ag) => {
        let agentDataSold = 0;
        let agentAirtimeSold = 0;

        try {
          if (Transaction) {
            const dataAgg = await Transaction.aggregate([
              {
                $match: {
                  user: ag._id,
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
            agentDataSold = dataAgg[0]?.totalVolume || 0;

            const airtimeAgg = await Transaction.aggregate([
              {
                $match: {
                  user: ag._id,
                  status: { $in: ["successful", "success", "completed"] },
                  type: { $in: ["airtime", "AIRTIME", "vtu", "VTU"] },
                },
              },
              {
                $group: {
                  _id: null,
                  totalAmount: { $sum: "$amount" },
                },
              },
            ]);
            agentAirtimeSold = airtimeAgg[0]?.totalAmount || 0;
          }
        } catch (e) {
          agentDataSold = 0;
          agentAirtimeSold = 0;
        }

        totalTeamDataSold += agentDataSold;
        totalTeamAirtimeSold += agentAirtimeSold;

        const tg = ag.targets || {};

        return {
          _id: ag._id,
          id: ag._id,
          name: ag.name || `${ag.firstName || ""} ${ag.surname || ""}`.trim() || "Retail Agent",
          firstName: ag.firstName,
          surname: ag.surname,
          phone: ag.phone,
          email: ag.email || `${ag.phone}@ayaxdata.online`,
          address: ag.address || "Outlet Location",
          walletBalance: ag.walletBalance || ag.balance || 0,
          balance: ag.balance || ag.walletBalance || 0,
          state: ag.state || myState,
          lga: ag.lga || myLga,
          isSuspended: ag.isSuspended || false,
          dataSold: agentDataSold,
          dataVolumeSold: agentDataSold,
          totalGB: agentDataSold,
          airtimeSold: agentAirtimeSold,
          targets: {
            dataGoal: tg.dataGoal || 100,
            airtimeGoal: tg.airtimeGoal || 10000,
            currentMonth: tg.currentMonth || "August 2026",
          },
        };
      })
    );

    let activityLogs = [];
    if (Activity) {
      activityLogs = await Activity.find({
        $or: [{ lga: myLga }, { user: supervisor._id }, { staffId: supervisor._id }],
      })
        .sort({ createdAt: -1 })
        .limit(30)
        .lean();
    }

    const supTargets = supervisor.targets || {};

    const dashboardPayload = {
      _id: supervisor._id,
      id: supervisor._id,
      name: supervisor.name || `${supervisor.firstName || ""} ${supervisor.surname || ""}`.trim(),
      phone: supervisor.phone,
      email: supervisor.email,
      state: myState,
      lga: myLga,
      walletBalance: supervisor.walletBalance || supervisor.balance || 0,
      agentsCount: formattedAgents.length,
      dataSold: totalTeamDataSold,
      airtimeSold: totalTeamAirtimeSold,
      myTarget: {
        dataGoal: supTargets.dataGoal || 500,
        airtimeGoal: supTargets.airtimeGoal || 50000,
        agentGoal: supTargets.agentGoal || 10,
        currentMonth: supTargets.currentMonth || "August 2026",
      },
      targets: supTargets,
      agents: formattedAgents,
      activityLogs,
    };

    return res.status(200).json({
      success: true,
      status: "success",
      data: dashboardPayload,
      agents: formattedAgents,
      activityLogs,
    });
  } catch (error) {
    console.error("Supervisor Dashboard Telemetry Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Get Supervisor Profile, Target, & Agents Matrix
 * @route   GET /api/v1/supervisor/profile
 */
exports.getSupervisorProfile = exports.getSupervisorDashboard;

/**
 * @desc    Get Supervisor Assigned Target Quota
 * @route   GET /api/v1/supervisor/my-target
 */
exports.getMyTarget = async (req, res) => {
  try {
    const user = await User.findById(req.user._id || req.user?.id).lean();
    const targets = user?.targets || {
      dataGoal: 500,
      airtimeGoal: 50000,
      agentGoal: 10,
      currentMonth: "August 2026",
    };

    return res.status(200).json({
      success: true,
      targets,
      data: targets,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Get Agents assigned to the logged-in Supervisor
 * @route   GET /api/v1/supervisor/my-agents OR GET /api/v1/supervisor/agents
 */
exports.getMyAgents = async (req, res) => {
  try {
    const supervisorId = req.user._id || req.user?.id;
    const supervisor = await User.findById(supervisorId).lean();

    const agents = await User.find({
      role: "agent",
      $or: [
        { assignedSupervisor: supervisorId },
        ...(supervisor?.lga ? [{ lga: supervisor.lga, state: supervisor.state }] : []),
      ],
    })
      .select("-password")
      .sort({ createdAt: -1 })
      .lean();

    const formattedAgents = agents.map((ag) => {
      const tg = ag.targets || {};
      return {
        _id: ag._id,
        id: ag._id,
        name: ag.name || `${ag.firstName || ""} ${ag.surname || ""}`.trim() || "Retail Agent",
        phone: ag.phone,
        email: ag.email || `${ag.phone}@ayaxdata.online`,
        address: ag.address || "Outlet Location",
        walletBalance: ag.walletBalance || ag.balance || 0,
        balance: ag.balance || ag.walletBalance || 0,
        state: ag.state || supervisor?.state,
        lga: ag.lga || supervisor?.lga,
        isSuspended: ag.isSuspended || false,
        targets: {
          dataGoal: tg.dataGoal || 100,
          airtimeGoal: tg.airtimeGoal || 10000,
          currentMonth: tg.currentMonth || "August 2026",
        },
      };
    });

    return res.status(200).json({
      success: true,
      count: formattedAgents.length,
      agents: formattedAgents,
      data: formattedAgents,
    });
  } catch (error) {
    console.error("Get My Agents Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAgents = exports.getMyAgents;

/**
 * @desc    Enroll / Create New Retail Agent (Persists to Database)
 * @route   POST /api/v1/supervisor/create-agent
 */
exports.createAgent = async (req, res) => {
  try {
    const { name, phone, email, password, address, state, lga } = req.body;

    if (!phone || !name) {
      return res.status(400).json({
        success: false,
        message: "Agent Name and Phone Number are required.",
      });
    }

    const supervisor = await User.findById(req.user._id || req.user?.id);
    const cleanPhone = String(phone).trim();
    const cleanState = String(state || supervisor?.state || "Kano").trim();
    const cleanLga = String(lga || supervisor?.lga || "Ajingi").trim();
    const cleanEmail = email
      ? String(email).toLowerCase().trim()
      : `${cleanPhone}@ayaxdata.online`;

    let user = await User.findOne({
      $or: [{ phone: cleanPhone }, { email: cleanEmail }],
    });

    if (user) {
      user.role = "agent";
      user.state = cleanState;
      user.lga = cleanLga;
      user.assignedSupervisor = supervisor?._id;
      user.assignedSupervisorName = supervisor?.name;
      if (address) user.address = address;
      await user.save({ validateBeforeSave: false });

      return res.status(200).json({
        success: true,
        message: `Existing account updated to Retail Agent under ${cleanLga} LGA.`,
        data: user,
      });
    }

    const names = name.trim().split(" ");
    const firstName = names[0] || "Retail";
    const surname = names.slice(1).join(" ") || "Agent";

    const newAgent = await User.create({
      firstName,
      surname,
      name: name.toUpperCase().trim(),
      email: cleanEmail,
      phone: cleanPhone,
      password: password || "Password123@",
      pin: "2026",
      transactionPin: "2026",
      role: "agent",
      state: cleanState,
      lga: cleanLga,
      address,
      assignedSupervisor: supervisor?._id || null,
      assignedSupervisorName: supervisor?.name || "Field Supervisor",
      walletBalance: 0,
      balance: 0,
      isSuspended: false,
      isVerified: true,
      status: "active",
      targets: {
        dataGoal: 100,
        airtimeGoal: 10000,
        currentMonth: "August 2026",
      },
    });

    if (Activity && supervisor?._id) {
      await Activity.create({
        staffId: supervisor._id,
        user: supervisor._id,
        lga: cleanLga,
        state: cleanState,
        action: "AGENT_ENROLLED",
        details: `Supervisor appointed ${newAgent.name} (${cleanPhone}) as Retail Agent for ${cleanLga} LGA`,
        targetUser: newAgent._id,
      }).catch(() => {});
    }

    return res.status(201).json({
      success: true,
      message: `Retail Agent ${newAgent.name} successfully registered!`,
      data: newAgent,
    });
  } catch (error) {
    console.error("Create Agent Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Assign / Update Data & Airtime Target to an Agent (Handles Auto-Split & Single Body)
 * @route   POST /api/v1/supervisor/assign-agent-target
 */
exports.assignAgentTarget = async (req, res) => {
  try {
    const { agentId, dataGoal, airtimeGoal, month } = req.body;

    if (!agentId) {
      return res.status(400).json({ success: false, message: "Agent ID is required." });
    }

    const currentMonthName = month || "August 2026";
    const dGoal = Number(dataGoal) || 0;
    const aGoal = Number(airtimeGoal) || 0;

    const agent = await User.findOneAndUpdate(
      { _id: agentId, role: "agent" },
      {
        $set: {
          "targets.dataGoal": dGoal,
          "targets.airtimeGoal": aGoal,
          "targets.currentMonth": currentMonthName,
        },
      },
      { new: true, runValidators: false }
    );

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    if (Activity && req.user?._id) {
      await Activity.create({
        staffId: req.user._id,
        user: req.user._id,
        action: "ASSIGN_AGENT_TARGET",
        details: `Supervisor allocated target quota (${dGoal}GB Data & ₦${aGoal} Airtime) to Agent ${agent.name}`,
        targetUser: agent._id,
      }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: "Agent quota updated successfully",
      targets: agent.targets,
    });
  } catch (error) {
    console.error("Assign Agent Target Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.assignTargetToAgent = exports.assignAgentTarget;

/**
 * @desc    Get Real-Time Activity Logs for Supervisor's LGA
 * @route   GET /api/v1/supervisor/activity-logs
 */
exports.getActivityLogs = async (req, res) => {
  try {
    const supervisor = await User.findById(req.user._id || req.user?.id);
    const myLga = supervisor?.lga || "Ajingi";

    let logs = [];
    if (Activity) {
      logs = await Activity.find({
        $or: [{ lga: myLga }, { user: supervisor._id }, { staffId: supervisor._id }],
      })
        .sort({ createdAt: -1 })
        .limit(40)
        .lean();
    }

    return res.status(200).json({
      success: true,
      logs,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Get Sales Summary for a specific Agent
 * @route   GET /api/v1/supervisor/agent-sales/:agentId
 */
exports.getAgentSalesSummary = async (req, res) => {
  try {
    const { agentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(agentId)) {
      return res.status(400).json({ success: false, message: "Invalid Agent ID format" });
    }

    let totalGB = 0;
    let totalAirtime = 0;
    let totalSalesCount = 0;

    if (Transaction) {
      const stats = await Transaction.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(agentId),
            status: { $in: ["successful", "success", "completed"] },
          },
        },
        {
          $group: {
            _id: "$type",
            totalVolume: { $sum: { $ifNull: ["$dataSize", "$volume", 0] } },
            totalAmount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]);

      stats.forEach((st) => {
        totalSalesCount += st.count;
        if (st._id === "data" || st._id === "DATA") {
          totalGB += st.totalVolume || st.totalAmount;
        } else {
          totalAirtime += st.totalAmount;
        }
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        totalGB,
        totalAirtime,
        totalAmount: totalAirtime,
        totalSalesCount,
      },
    });
  } catch (error) {
    console.error("Get Agent Sales Summary Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};