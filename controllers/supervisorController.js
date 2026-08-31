const User = require("../models/User");
const mongoose = require("mongoose");

let Activity = null;
try {
  Activity = require("../models/Activity");
} catch (e) {
  try {
    Activity = require("../models/activityModel");
  } catch (err) {
    Activity = null;
  }
}

let TargetHistory = null;
try {
  TargetHistory = require("../models/TargetHistory");
} catch (e) {
  TargetHistory = null;
}

let Transaction = null;
try {
  Transaction = require("../models/Transaction");
} catch (e) {
  Transaction = null;
}

/**
 * @desc    Get Supervisor Dashboard Real-Time Telemetry & Agents
 * @route   GET /api/v1/supervisor/dashboard
 */
exports.getSupervisorDashboard = async (req, res) => {
  try {
    const supervisorId = req.user?._id || req.user?.id;
    if (!supervisorId) {
      return res.status(401).json({ success: false, message: "Unauthorized access" });
    }

    const supervisor = await User.findById(supervisorId).select("-password -pin -transactionPin").lean();
    if (!supervisor) {
      return res.status(404).json({ success: false, message: "Supervisor profile not found" });
    }

    const myLga = String(supervisor.lga || "Ajingi").trim();
    const myState = String(supervisor.state || "Kano").trim();
    const myPhone = String(supervisor.phone || "").trim();
    const myRefCode = String(
      supervisor.referralCode ||
      supervisor.referralId ||
      `AYX-${myLga.toUpperCase()}-${myPhone.slice(-4)}`
    ).trim();

    // 1. Kwaso dukkan Agents na LGA ko da Referral Code
    const agents = await User.find({
      _id: { $ne: supervisor._id },
      $or: [
        { assignedSupervisor: supervisor._id },
        { assignedSupervisor: String(supervisor._id) },
        { lga: new RegExp(`^${myLga}$`, "i") },
        { referredBy: myRefCode },
        { supervisorId: myRefCode },
      ],
    })
      .select("-password -pin -transactionPin")
      .sort({ createdAt: -1 })
      .lean();

    // 2. Kwaso Target din Supervisor (Daga User ko TargetHistory)
    let supTargets = supervisor.targets || {};
    if ((!supTargets.dataGoal && !supTargets.airtimeGoal) && TargetHistory) {
      try {
        const latestHistory = await TargetHistory.findOne({
          $or: [
            { assignedTo: supervisor._id },
            { lga: new RegExp(`^${myLga}$`, "i") },
          ],
        })
          .sort({ createdAt: -1 })
          .lean();

        if (latestHistory) {
          supTargets = {
            dataGoal: latestHistory.dataGoal || 0,
            airtimeGoal: latestHistory.airtimeGoal || 0,
            agentGoal: latestHistory.agentGoal || 10,
            currentMonth: latestHistory.month || "August 2026",
          };
        }
      } catch (thErr) {}
    }

    let totalTeamDataSold = 0;
    let totalTeamAirtimeSold = 0;

    const formattedAgents = agents.map((ag) => {
      // Tabbatar an duba ko an tura masa target ta User ko an ɗauki na LGA
      const tg = ag.targets || {};
      const agentDataSold = Number(ag.dataVolumeSold || ag.dataSold || 0);
      const agentAirtimeSold = Number(ag.airtimeSold || 0);

      totalTeamDataSold += agentDataSold;
      totalTeamAirtimeSold += agentAirtimeSold;

      return {
        _id: ag._id,
        id: ag._id,
        name: ag.name || `${ag.firstName || ""} ${ag.surname || ""}`.trim() || "Retail Agent",
        firstName: ag.firstName,
        surname: ag.surname,
        phone: ag.phone,
        email: ag.email || `${ag.phone}@ayaxdata.online`,
        address: ag.address || `${ag.lga || myLga} LGA`,
        walletBalance: Number(ag.walletBalance || ag.balance || 0),
        balance: Number(ag.balance || ag.walletBalance || 0),
        state: ag.state || myState,
        lga: ag.lga || myLga,
        role: ag.role || "agent",
        isSuspended: Boolean(ag.isSuspended),
        dataSold: agentDataSold,
        dataVolumeSold: agentDataSold,
        totalGB: agentDataSold,
        airtimeSold: agentAirtimeSold,
        targets: {
          dataGoal: Number(tg.dataGoal || ag.dataGoal || 0),
          airtimeGoal: Number(tg.airtimeGoal || ag.airtimeGoal || 0),
          currentMonth: tg.currentMonth || supTargets.currentMonth || "August 2026",
        },
      };
    });

    let activityLogs = [];
    if (Activity) {
      try {
        activityLogs = await Activity.find({
          $or: [
            { lga: new RegExp(`^${myLga}$`, "i") },
            { user: supervisor._id },
            { staffId: supervisor._id },
          ],
        })
          .sort({ createdAt: -1 })
          .limit(20)
          .lean();
      } catch (e) {
        activityLogs = [];
      }
    }

    const dashboardPayload = {
      _id: supervisor._id,
      id: supervisor._id,
      name: supervisor.name || `${supervisor.firstName || ""} ${supervisor.surname || ""}`.trim(),
      phone: supervisor.phone,
      email: supervisor.email,
      state: myState,
      lga: myLga,
      referralCode: myRefCode,
      referralId: myRefCode,
      walletBalance: Number(supervisor.walletBalance || supervisor.balance || 0),
      agentsCount: formattedAgents.length,
      dataSold: totalTeamDataSold,
      airtimeSold: totalTeamAirtimeSold,
      myTarget: {
        dataGoal: Number(supTargets.dataGoal || 0),
        airtimeGoal: Number(supTargets.airtimeGoal || 0),
        agentGoal: Number(supTargets.agentGoal || 10),
        currentMonth: supTargets.currentMonth || "August 2026",
      },
      targets: {
        dataGoal: Number(supTargets.dataGoal || 0),
        airtimeGoal: Number(supTargets.airtimeGoal || 0),
        agentGoal: Number(supTargets.agentGoal || 10),
        currentMonth: supTargets.currentMonth || "August 2026",
      },
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
    console.error("Supervisor Dashboard Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Get Supervisor Profile
 * @route   GET /api/v1/supervisor/profile
 */
exports.getSupervisorProfile = exports.getSupervisorDashboard;

/**
 * @desc    Get Supervisor Target
 * @route   GET /api/v1/supervisor/my-target
 */
exports.getMyTarget = async (req, res) => {
  try {
    const supervisorId = req.user?._id || req.user?.id;
    const user = await User.findById(supervisorId).lean();
    const myLga = user?.lga || "Ajingi";

    let targets = user?.targets || {};

    if ((!targets.dataGoal && !targets.airtimeGoal) && TargetHistory) {
      try {
        const history = await TargetHistory.findOne({
          $or: [
            { assignedTo: supervisorId },
            { lga: new RegExp(`^${myLga}$`, "i") },
          ],
        })
          .sort({ createdAt: -1 })
          .lean();

        if (history) {
          targets = {
            dataGoal: history.dataGoal || 0,
            airtimeGoal: history.airtimeGoal || 0,
            agentGoal: history.agentGoal || 10,
            currentMonth: history.month || "August 2026",
          };
        }
      } catch (e) {}
    }

    const finalTargets = {
      dataGoal: Number(targets.dataGoal || 0),
      airtimeGoal: Number(targets.airtimeGoal || 0),
      agentGoal: Number(targets.agentGoal || 10),
      currentMonth: targets.currentMonth || "August 2026",
    };

    return res.status(200).json({
      success: true,
      targets: finalTargets,
      data: finalTargets,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Get Agents Directory
 * @route   GET /api/v1/supervisor/agents OR GET /api/v1/supervisor/my-agents
 */
exports.getMyAgents = async (req, res) => {
  try {
    const supervisorId = req.user?._id || req.user?.id;
    const supervisor = await User.findById(supervisorId).lean();

    if (!supervisor) {
      return res.status(404).json({ success: false, message: "Supervisor not found" });
    }

    const myLga = String(supervisor?.lga || "Ajingi").trim();
    const myState = String(supervisor?.state || "Kano").trim();
    const myPhone = String(supervisor?.phone || "").trim();
    const myRefCode = String(
      supervisor?.referralCode ||
      supervisor?.referralId ||
      `AYX-${myLga.toUpperCase()}-${myPhone.slice(-4)}`
    ).trim();

    const agents = await User.find({
      _id: { $ne: supervisor._id },
      $or: [
        { assignedSupervisor: supervisorId },
        { assignedSupervisor: String(supervisorId) },
        { lga: new RegExp(`^${myLga}$`, "i") },
        { referredBy: myRefCode },
        { supervisorId: myRefCode },
      ],
    })
      .select("-password -pin -transactionPin")
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
        address: ag.address || `${ag.lga || myLga} LGA`,
        walletBalance: Number(ag.walletBalance || ag.balance || 0),
        balance: Number(ag.balance || ag.walletBalance || 0),
        state: ag.state || myState,
        lga: ag.lga || myLga,
        role: ag.role || "agent",
        isSuspended: Boolean(ag.isSuspended),
        targets: {
          dataGoal: Number(tg.dataGoal || ag.dataGoal || 0),
          airtimeGoal: Number(tg.airtimeGoal || ag.airtimeGoal || 0),
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
 * @desc    Enroll / Signup Agent under Supervisor with Referral Code
 * @route   POST /api/v1/supervisor/create-agent
 */
exports.createAgent = async (req, res) => {
  try {
    const { firstName, surname, name, phone, email, password, address, state, lga, referralCode, referredBy, supervisorId } = req.body;

    if (!phone || (!name && !firstName)) {
      return res.status(400).json({
        success: false,
        message: "Agent Name and Phone Number are required.",
      });
    }

    const supervisor = await User.findById(req.user?._id || req.user?.id);
    const cleanPhone = String(phone).trim();
    const cleanState = String(state || supervisor?.state || "Kano").trim();
    const cleanLga = String(lga || supervisor?.lga || "Ajingi").trim();
    const cleanEmail = email
      ? String(email).toLowerCase().trim()
      : `${cleanPhone}@ayaxdata.online`;

    let user = await User.findOne({
      $or: [{ phone: cleanPhone }, { email: cleanEmail }],
    });

    const activeRef = referralCode || referredBy || supervisorId || supervisor?.referralCode || supervisor?.referralId;

    if (user) {
      user.role = "agent";
      user.state = cleanState;
      user.lga = cleanLga;
      user.assignedSupervisor = supervisor?._id;
      user.assignedSupervisorName = supervisor?.name;
      if (address) user.address = address;
      if (activeRef) {
        user.referredBy = activeRef;
        user.supervisorId = activeRef;
      }
      await user.save({ validateBeforeSave: false });

      return res.status(200).json({
        success: true,
        message: `Existing user profile promoted to Retail Agent under ${cleanLga} LGA.`,
        data: user,
      });
    }

    const first = firstName || (name ? name.trim().split(" ")[0] : "Retail");
    const sur = surname || (name ? name.trim().split(" ").slice(1).join(" ") : "Agent");
    const fullName = name || `${first} ${sur}`.trim();

    const newAgent = await User.create({
      firstName: first,
      surname: sur,
      name: fullName.toUpperCase().trim(),
      email: cleanEmail,
      phone: cleanPhone,
      password: password || "Password123@",
      pin: "2026",
      transactionPin: "2026",
      role: "agent",
      state: cleanState,
      lga: cleanLga,
      address: address || `${cleanLga} LGA`,
      referredBy: activeRef,
      supervisorId: activeRef,
      assignedSupervisor: supervisor?._id || null,
      assignedSupervisorName: supervisor?.name || "Field Supervisor",
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

    if (Activity && supervisor?._id) {
      try {
        await Activity.create({
          staffId: supervisor._id,
          user: supervisor._id,
          lga: cleanLga,
          state: cleanState,
          action: "AGENT_ENROLLED",
          details: `Supervisor enrolled ${newAgent.name} (${cleanPhone}) as Retail Agent`,
          targetUser: newAgent._id,
        });
      } catch (e) {}
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
 * @desc    Get Real-Time Activity Logs for Supervisor LGA
 * @route   GET /api/v1/supervisor/activity-logs
 */
exports.getActivityLogs = async (req, res) => {
  try {
    const supervisor = await User.findById(req.user?._id || req.user?.id);
    const myLga = supervisor?.lga || "Ajingi";

    let logs = [];
    if (Activity) {
      try {
        logs = await Activity.find({
          $or: [
            { lga: new RegExp(`^${myLga}$`, "i") },
            { user: supervisor?._id },
            { staffId: supervisor?._id },
          ],
        })
          .sort({ createdAt: -1 })
          .limit(30)
          .lean();
      } catch (e) {
        logs = [];
      }
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

    return res.status(200).json({
      success: true,
      data: {
        totalGB: 0,
        totalAirtime: 0,
        totalAmount: 0,
        totalSalesCount: 0,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};