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


const findUserByIdentifier = async (identifier) => {
  if (!identifier) return null;
  const clean = String(identifier).trim();

  const queryConditions = [
    { referralCode: clean.toUpperCase() },
    { referralId: clean.toUpperCase() },
    { phone: clean },
    { email: clean.toLowerCase() },
  ];

  if (mongoose.Types.ObjectId.isValid(clean)) {
    queryConditions.unshift({ _id: clean });
  }

  return await User.findOne({ $or: queryConditions });
};
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


// 1. Reassign all agents from one supervisor to another (Bulk Transfer via Ref Code or ID)
exports.transferAllAgentsToNewSupervisor = async (req, res) => {
  try {
    const {
      oldSupervisorId,
      oldSupervisorRef,
      newSupervisorId,
      newSupervisorRef,
    } = req.body;

    const sourceInput = String(oldSupervisorRef || oldSupervisorId || "").trim();
    const destInput = String(newSupervisorRef || newSupervisorId || "").trim();

    if (!sourceInput || !destInput) {
      return res.status(400).json({
        success: false,
        message: "Both source and destination supervisor Ref codes (or IDs) are required.",
      });
    }

    if (sourceInput.toUpperCase() === destInput.toUpperCase()) {
      return res.status(400).json({
        success: false,
        message: "Source and destination supervisors cannot be the same.",
      });
    }

    // Nemo tsohon da sabon supervisor ta hanyar Ref Code, Phone, ko _id
    const [oldSupervisor, newSupervisor] = await Promise.all([
      findUserByIdentifier(sourceInput),
      findUserByIdentifier(destInput),
    ]);

    if (!newSupervisor) {
      return res.status(404).json({
        success: false,
        message: `Destination supervisor [${destInput}] not found.`,
      });
    }

    // Tattara dukkan hanyoyin da za a gano wakilan tsohon mai kula
    const oldSupId = oldSupervisor ? oldSupervisor._id : (mongoose.Types.ObjectId.isValid(sourceInput) ? sourceInput : null);
    const oldSupRef = oldSupervisor?.referralCode || sourceInput.toUpperCase();
    const oldSupPhone = oldSupervisor?.phone;

    const matchConditions = [];
    if (oldSupId) {
      matchConditions.push({ supervisorId: oldSupId });
      matchConditions.push({ assignedSupervisor: oldSupId });
    }
    if (oldSupRef) {
      matchConditions.push({ supervisorRef: oldSupRef });
      matchConditions.push({ referredBy: oldSupRef });
      matchConditions.push({ supervisorId: oldSupRef });
    }
    if (oldSupPhone) {
      matchConditions.push({ supervisorPhone: oldSupPhone });
    }

    const newDestRef = newSupervisor.referralCode || `AYX-${(newSupervisor.lga || "LGA").toUpperCase()}-${String(newSupervisor.phone || "0000").slice(-4)}`;

    const updateResult = await User.updateMany(
      { $or: matchConditions },
      {
        $set: {
          supervisorId: newSupervisor._id,
          assignedSupervisor: newSupervisor._id,
          supervisorRef: newDestRef,
          assignedSupervisorName: newSupervisor.fullName || newSupervisor.name || "Supervisor",
          referredBy: newDestRef,
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: `Successfully transferred ${updateResult.modifiedCount} agents to ${newSupervisor.fullName || newSupervisor.name} (${newDestRef}).`,
      transferredCount: updateResult.modifiedCount,
      destinationSupervisor: {
        id: newSupervisor._id,
        name: newSupervisor.fullName || newSupervisor.name,
        ref: newDestRef,
      },
    });
  } catch (error) {
    console.error("Bulk agent transfer error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error during bulk transfer.",
    });
  }
};

// 2. Reassign a single agent to a new supervisor (via Ref Code, Phone, or ID)
exports.transferSingleAgent = async (req, res) => {
  try {
    const {
      agentId,
      agentRef,
      newSupervisorId,
      newSupervisorRef,
    } = req.body;

    const agentInput = String(agentRef || agentId || "").trim();
    const destInput = String(newSupervisorRef || newSupervisorId || "").trim();

    if (!agentInput || !destInput) {
      return res.status(400).json({
        success: false,
        message: "Agent identifier and destination supervisor Ref code are required.",
      });
    }

    const [targetAgent, newSupervisor] = await Promise.all([
      findUserByIdentifier(agentInput),
      findUserByIdentifier(destInput),
    ]);

    if (!targetAgent) {
      return res.status(404).json({
        success: false,
        message: `Agent [${agentInput}] not found.`,
      });
    }

    if (!newSupervisor) {
      return res.status(404).json({
        success: false,
        message: `Destination supervisor [${destInput}] not found.`,
      });
    }

    const newDestRef = newSupervisor.referralCode || `AYX-${(newSupervisor.lga || "LGA").toUpperCase()}-${String(newSupervisor.phone || "0000").slice(-4)}`;

    targetAgent.supervisorId = newSupervisor._id;
    targetAgent.assignedSupervisor = newSupervisor._id;
    targetAgent.supervisorRef = newDestRef;
    targetAgent.assignedSupervisorName = newSupervisor.fullName || newSupervisor.name || "Supervisor";
    targetAgent.referredBy = newDestRef;

    await targetAgent.save();

    return res.status(200).json({
      success: true,
      message: `Successfully reassigned agent [${targetAgent.fullName || targetAgent.name}] to ${newSupervisor.fullName || newSupervisor.name} (${newDestRef}).`,
      agent: {
        id: targetAgent._id,
        name: targetAgent.fullName || targetAgent.name,
        phone: targetAgent.phone,
        newSupervisorRef: newDestRef,
      },
    });
  } catch (error) {
    console.error("Single agent transfer error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error during agent transfer.",
    });
  }
};