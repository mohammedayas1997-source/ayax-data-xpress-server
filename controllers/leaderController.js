const User = require("../models/User");
const TargetHistory = require("../models/TargetHistory");
const Activity = require("../models/Activity");
const mongoose = require("mongoose");

let Transaction;
try {
  Transaction = require("../models/Transaction");
} catch (e) {
  Transaction = null;
}

// 1. Get State Manager (Leader) Dashboard Data
exports.getLeaderDashboard = async (req, res) => {
  try {
    const leaderId = req.user._id;
    const leaderState = req.user.state || req.query.state || "Kano";

    const leaderUser = await User.findById(leaderId).lean();
    const myTargets = leaderUser?.targets || {
      dataGoal: 5000,
      airtimeGoal: 500000,
      supervisorGoal: 10,
      currentMonth: "August 2026",
    };

    const supervisorQuery = {
      role: { $in: ["supervisor", "field_supervisor"] },
      $or: [
        { assignedLeader: leaderId },
        ...(leaderState ? [{ state: new RegExp(`^${leaderState}$`, "i") }] : []),
      ],
    };

    const supervisors = await User.find(supervisorQuery).lean();
    let totalAgentsCount = 0;
    let totalStateDataSold = 0;
    let totalStateAirtimeSold = 0;

    const supDetails = await Promise.all(
      supervisors.map(async (sup) => {
        const agents = await User.find({
          role: "agent",
          $or: [
            { assignedSupervisor: sup._id },
            { lga: sup.lga, state: sup.state },
          ],
        })
          .select("_id name firstName surname phone walletBalance balance state lga targets")
          .lean();

        const agentIds = agents.map((a) => a._id);
        totalAgentsCount += agents.length;

        let teamDataSold = 0;
        let teamAirtimeSold = 0;

        try {
          if (Transaction) {
            const allTeamIds = [sup._id, ...agentIds];

            // A. Data Sales Volume
            const dataAgg = await Transaction.aggregate([
              {
                $match: {
                  user: { $in: allTeamIds },
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
            teamDataSold = dataAgg[0]?.totalVolume || 0;

            // B. Airtime Sales Amount
            const airtimeAgg = await Transaction.aggregate([
              {
                $match: {
                  user: { $in: allTeamIds },
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
            teamAirtimeSold = airtimeAgg[0]?.totalAmount || 0;
          }
        } catch (err) {
          teamDataSold = sup.balance || 0;
          teamAirtimeSold = 0;
        }

        totalStateDataSold += teamDataSold;
        totalStateAirtimeSold += teamAirtimeSold;

        const tg = sup.targets || {};

        return {
          id: sup._id,
          _id: sup._id,
          name: sup.name || `${sup.firstName || ""} ${sup.surname || ""}`.trim() || "Field Supervisor",
          firstName: sup.firstName,
          surname: sup.surname,
          email: sup.email,
          phone: sup.phone,
          state: sup.state || leaderState,
          lga: sup.lga || "Central",
          isSuspended: sup.isSuspended || false,
          teamSize: agents.length,
          agentsCount: agents.length,
          teamPerformance: teamDataSold,
          dataSold: teamDataSold,
          airtimeSold: teamAirtimeSold,
          dataGoal: tg.dataGoal || 0,
          airtimeGoal: tg.airtimeGoal || 0,
          agentGoal: tg.agentGoal || 0,
          targetAssigned: Boolean(tg.dataGoal || tg.airtimeGoal),
          targets: tg,
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        leaderState: leaderState || "National",
        myTargets: {
          ...myTargets,
          dataSold: totalStateDataSold,
          airtimeSold: totalStateAirtimeSold,
        },
        networkStats: {
          totalSupervisors: supervisors.length,
          totalAgents: totalAgentsCount,
          overallDataSold: totalStateDataSold,
          overallAirtimeSold: totalStateAirtimeSold,
          activeQuotas: supDetails.filter((s) => s.targetAssigned).length,
        },
        supervisors: supDetails,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Get Agents Stream with Targets & Supervisor Details
exports.getAgentsStream = async (req, res) => {
  try {
    const leaderState = req.user.state || req.query.state || "";
    const agentQuery = {
      role: "agent",
      ...(leaderState ? { state: new RegExp(`^${leaderState}$`, "i") } : {}),
    };

    const agents = await User.find(agentQuery)
      .populate("assignedSupervisor", "name firstName surname phone lga")
      .select("-password")
      .lean();

    const formattedAgents = agents.map((ag) => {
      const tg = ag.targets || {};
      return {
        id: ag._id,
        _id: ag._id,
        name: ag.name || `${ag.firstName || ""} ${ag.surname || ""}`.trim() || "Retail Agent",
        phone: ag.phone,
        email: ag.email,
        state: ag.state || leaderState,
        lga: ag.lga || "Hub",
        walletBalance: ag.walletBalance || ag.balance || 0,
        balance: ag.balance || 0,
        assignedSupervisor: ag.assignedSupervisor || null,
        assignedSupervisorName:
          ag.assignedSupervisor?.name ||
          `${ag.assignedSupervisor?.firstName || ""} ${ag.assignedSupervisor?.surname || ""}`.trim() ||
          "Unassigned",
        totalSalesCount: ag.salesCount || 0,
        dataVolumeSold: ag.dataSold || 0,
        dataSold: ag.dataSold || 0,
        airtimeSold: ag.airtimeSold || 0,
        dataGoal: tg.dataGoal || 0,
        airtimeGoal: tg.airtimeGoal || 0,
        targets: tg,
      };
    });

    res.status(200).json({ success: true, count: formattedAgents.length, agents: formattedAgents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 3. Get All Agents (Function din da ya bace a baya)
exports.getAllAgents = async (req, res) => {
  try {
    const leaderState = req.user.state || req.query.state || "";
    const agentQuery = {
      role: "agent",
      ...(leaderState ? { state: new RegExp(`^${leaderState}$`, "i") } : {}),
    };

    const agents = await User.find(agentQuery)
      .populate("assignedSupervisor", "name email phone lga")
      .select("-password")
      .lean();

    res.status(200).json({ success: true, count: agents.length, agents, data: agents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 4. Assign / Update / Clear Targets (Single ko Bulk ga Supervisors ko Agents)
exports.assignSupervisorTarget = async (req, res) => {
  try {
    const {
      mode,
      supervisorId,
      supervisorIds,
      agentId,
      agentIds,
      dataGoal,
      airtimeGoal,
      agentGoal,
      month,
      state,
      lga,
    } = req.body;

    const targetMonth = month || new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
    const targetPayload = {
      dataGoal: Number(dataGoal) || 0,
      airtimeGoal: Number(airtimeGoal) || 0,
      agentGoal: Number(agentGoal) || 0,
      currentMonth: targetMonth,
      state: state || req.user.state,
      lga: lga || undefined,
      assignedByLeader: req.user._id,
    };

    // 1. Bulk Supervisors
    if (mode === "bulk_sup" && Array.isArray(supervisorIds) && supervisorIds.length > 0) {
      await User.updateMany(
        { _id: { $in: supervisorIds } },
        { $set: { targets: targetPayload, assignedLeader: req.user._id } }
      );

      await Activity.create({
        staffId: req.user._id,
        action: "BULK_SUPERVISOR_TARGETS_DEPLOYED",
        details: `State Manager deployed identical target (${dataGoal} GB & ₦${airtimeGoal}) across ${supervisorIds.length} Field Supervisors`,
      });

      return res.status(200).json({
        success: true,
        message: `Targets deployed across ${supervisorIds.length} Supervisors`,
      });
    }

    // 2. Bulk Agents
    if (mode === "bulk_agent" && Array.isArray(agentIds) && agentIds.length > 0) {
      await User.updateMany(
        { _id: { $in: agentIds } },
        { $set: { targets: targetPayload } }
      );

      await Activity.create({
        staffId: req.user._id,
        action: "BULK_AGENT_TARGETS_DEPLOYED",
        details: `State Manager deployed identical target (${dataGoal} GB & ₦${airtimeGoal}) across ${agentIds.length} Retail Agents`,
      });

      return res.status(200).json({
        success: true,
        message: `Targets deployed across ${agentIds.length} Agents`,
      });
    }

    // 3. Single Agent
    if ((mode === "single_agent" || agentId) && !supervisorId) {
      const targetAgentId = agentId || req.body.agentId;
      const agent = await User.findById(targetAgentId);
      if (!agent) return res.status(404).json({ success: false, message: "Agent not found" });

      agent.targets = targetPayload;
      agent.markModified("targets");
      await agent.save();

      await Activity.create({
        staffId: req.user._id,
        action: dataGoal === 0 && airtimeGoal === 0 ? "AGENT_TARGET_CLEARED" : "AGENT_TARGET_DEPLOYED",
        details: `Updated target (${dataGoal} GB & ₦${airtimeGoal}) for Agent ${agent.name} (${agent.phone})`,
        targetUser: agent._id,
      });

      return res.status(200).json({
        success: true,
        message: "Agent target quota updated successfully",
        targets: agent.targets,
      });
    }

    // 4. Single Supervisor (Default)
    const targetSupId = supervisorId || req.body.supervisorId;
    if (!targetSupId) {
      return res.status(400).json({ success: false, message: "Supervisor ID or recipient list required" });
    }

    const supervisor = await User.findById(targetSupId);
    if (!supervisor) return res.status(404).json({ success: false, message: "Supervisor not found" });

    supervisor.targets = { ...targetPayload, lga: supervisor.lga || lga };
    supervisor.assignedLeader = req.user._id;
    supervisor.markModified("targets");
    await supervisor.save();

    await TargetHistory.create({
      assignedTo: supervisor._id,
      assignedBy: req.user._id,
      dataGoal: Number(dataGoal) || 0,
      airtimeGoal: Number(airtimeGoal) || 0,
      agentGoal: Number(agentGoal) || 0,
      month: targetMonth,
      state: supervisor.state,
      lga: supervisor.lga,
    });

    await Activity.create({
      staffId: req.user._id,
      action: dataGoal === 0 && airtimeGoal === 0 ? "SUPERVISOR_TARGET_CLEARED" : "SUPERVISOR_TARGET_DEPLOYED",
      details: `Updated quota (${dataGoal} GB & ₦${airtimeGoal}) for Supervisor ${supervisor.name} (${supervisor.lga || "LGA"})`,
      targetUser: supervisor._id,
    });

    res.status(200).json({
      success: true,
      message: "Target quota successfully assigned",
      targets: supervisor.targets,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 5. Assign Agent(s) to Supervisor (Single ko Bulk Reassignment)
exports.assignAgentToSupervisor = async (req, res) => {
  try {
    const { agentId, agentIds, supervisorId } = req.body;

    if (!supervisorId) {
      return res.status(400).json({ success: false, message: "Supervisor ID is required" });
    }

    const supervisor = await User.findById(supervisorId);
    if (!supervisor) {
      return res.status(404).json({ success: false, message: "Target Field Supervisor not found" });
    }

    // Bulk Reassign
    if (Array.isArray(agentIds) && agentIds.length > 0) {
      await User.updateMany(
        { _id: { $in: agentIds }, role: "agent" },
        {
          $set: {
            assignedSupervisor: supervisor._id,
            lga: supervisor.lga || undefined,
          },
        }
      );

      await Activity.create({
        staffId: req.user._id,
        action: "BULK_AGENTS_REASSIGNED",
        details: `Reassigned ${agentIds.length} agents to Supervisor ${supervisor.name} (${supervisor.lga || "LGA"})`,
      });

      return res.status(200).json({
        success: true,
        message: `Successfully reassigned ${agentIds.length} agents to ${supervisor.name}`,
      });
    }

    // Single Reassign
    if (!agentId) {
      return res.status(400).json({ success: false, message: "Agent ID or agentIds list required" });
    }

    const agent = await User.findOneAndUpdate(
      { _id: agentId, role: "agent" },
      {
        assignedSupervisor: supervisor._id,
        lga: supervisor.lga || undefined,
      },
      { new: true }
    );

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    await Activity.create({
      staffId: req.user._id,
      action: "AGENT_REASSIGNED",
      details: `Reassigned Agent ${agent.name} to Supervisor ${supervisor.name} (${supervisor.lga || "LGA"})`,
      targetUser: agent._id,
    });

    res.status(200).json({
      success: true,
      message: `Agent assigned to ${supervisor.name} successfully`,
      agent,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 6. Live Audit Stream
exports.getLiveAuditStream = async (req, res) => {
  try {
    const logs = await Activity.find()
      .populate("staffId", "name phone role")
      .populate("targetUser", "name phone role")
      .sort("-createdAt")
      .limit(50)
      .lean();

    const formattedLogs = logs.map((log) => ({
      _id: log._id,
      category: log.action || "FIELD_ACTION",
      details: log.details || "Territory event logged",
      createdAt: log.createdAt,
      user: {
        phone: log.staffId?.phone || log.staffId?.name || "System",
      },
      actorRole: log.staffId?.role || "Leader",
    }));

    res.status(200).json({ success: true, logs: formattedLogs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 7. Create New Supervisor
exports.createNewSupervisor = async (req, res) => {
  try {
    const { email, phone, password, firstName, surname, name, state, lga, address } = req.body;

    if (!phone || (!name && (!firstName || !surname))) {
      return res.status(400).json({
        success: false,
        message: "Please provide supervisor name, phone number, and LGA",
      });
    }

    const cleanPhone = phone.trim();
    const cleanEmail = email ? email.toLowerCase().trim() : `${cleanPhone}@ayaxdata.online`;

    const existingUser = await User.findOne({
      $or: [{ phone: cleanPhone }, { email: cleanEmail }],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User with this phone number or email already exists",
      });
    }

    const finalFirstName = firstName || name.split(" ")[0] || "Supervisor";
    const finalSurname = surname || name.split(" ").slice(1).join(" ") || "Lead";

    const newSup = await User.create({
      firstName: finalFirstName,
      surname: finalSurname,
      name: (name || `${finalFirstName} ${finalSurname}`).toUpperCase().trim(),
      email: cleanEmail,
      phone: cleanPhone,
      password: password || "Password123@",
      pin: "2026",
      transactionPin: "2026",
      role: "supervisor",
      state: state || req.user.state || "Kano",
      lga: lga || "Central",
      address: address || `${lga}, ${state}`,
      assignedLeader: req.user._id,
      walletBalance: 50000,
      balance: 50000,
      isSuspended: false,
      isVerified: true,
      status: "active",
    });

    await Activity.create({
      staffId: req.user._id,
      action: "SUPERVISOR_ENROLLED",
      details: `Appointed ${newSup.name} as Supervisor for ${newSup.lga} LGA, ${newSup.state} State`,
      targetUser: newSup._id,
    });

    res.status(201).json({
      success: true,
      message: "Supervisor appointed successfully",
      data: newSup,
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// 8. Toggle Supervisor Suspension Status
exports.toggleSupervisorStatus = async (req, res) => {
  try {
    const supervisorId = req.params.supervisorId || req.params.id || req.body.supervisorId;
    const user = await User.findById(supervisorId);

    if (!user) {
      return res.status(404).json({ success: false, message: "Supervisor not found" });
    }

    user.isSuspended = !user.isSuspended;
    await user.save();

    await Activity.create({
      staffId: req.user._id,
      action: user.isSuspended ? "SUPERVISOR_SUSPENDED" : "SUPERVISOR_ACTIVATED",
      details: `Changed status for ${user.name || user.phone} to ${user.isSuspended ? "SUSPENDED" : "ACTIVE"}`,
      targetUser: user._id,
    });

    res.status(200).json({
      success: true,
      message: `Supervisor status updated successfully`,
      isSuspended: user.isSuspended,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 9. Download Supervisor & Territory Report (CSV)
exports.downloadSupervisorReport = async (req, res) => {
  try {
    const leaderState = req.user.state || "";
    const supervisors = await User.find({
      role: { $in: ["supervisor", "field_supervisor"] },
      ...(leaderState ? { state: new RegExp(`^${leaderState}$`, "i") } : {}),
    }).lean();

    let csvHeader = "Supervisor Name,Phone,Email,State,LGA,Target Month,Data Goal (GB),Airtime Goal (NGN),Agent Goal,Status\n";
    let csvRows = supervisors
      .map((s) => {
        const tg = s.targets || {};
        return `"${s.name || s.phone}","${s.phone}","${s.email}","${s.state || ""}","${s.lga || ""}","${tg.currentMonth || "N/A"}",${tg.dataGoal || 0},${tg.airtimeGoal || 0},${tg.agentGoal || 0},"${s.isSuspended ? "Suspended" : "Active"}"`;
      })
      .join("\n");

    const csvData = csvHeader + csvRows;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=State-Supervisor-Report.csv`);
    return res.status(200).send(csvData);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
// @desc    Get SM State Quota & System Auto-Distribution Matrix
// @route   GET /api/v1/leader/my-state-target
exports.getMyStateTarget = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const stateName = user.state || "Kano";
    const targets = user.targets || {
      dataGoal: 5000,
      airtimeGoal: 500000,
      agentGoal: 50,
      supervisorGoal: 10,
      currentMonth: "August 2026",
    };

    // Nemo Supervisors da Agents na wannan jihar
    const [supervisors, agents] = await Promise.all([
      User.find({ role: { $in: ["supervisor", "field_supervisor"] }, state: new RegExp(`^${stateName}$`, "i") })
        .select("name firstName surname phone lga targets")
        .lean(),
      User.find({ role: "agent", state: new RegExp(`^${stateName}$`, "i") })
        .select("name firstName surname phone lga targets assignedSupervisorName")
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        state: stateName,
        assignedTargets: targets,
        supervisorsCount: supervisors.length,
        agentsCount: agents.length,
        supervisors,
        agents,
      },
      targets,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
// @desc    State Manager (SM) Appoints / Enrolls a New Field Supervisor (FS)
// @route   POST /api/v1/leader/create-supervisor
exports.appointStateLeader = async (req, res) => {
  try {
    const { name, phone, email, state, lga, password } = req.body;

    if (!phone || !name) {
      return res.status(400).json({
        success: false,
        message: "Supervisor Name and Phone Number are required.",
      });
    }

    const cleanPhone = String(phone).trim();
    const cleanState = String(state || req.user?.state || "Kano").trim();
    const cleanLga = String(lga || "Ajingi").trim();
    const cleanEmail = email
      ? String(email).toLowerCase().trim()
      : `${cleanPhone}@ayaxdata.online`;

    // 1. Duba idan mai wannan lambar ko email din ya riga ya wanzu
    let existingUser = await User.findOne({
      $or: [{ phone: cleanPhone }, { email: cleanEmail }],
    });

    if (existingUser) {
      existingUser.role = "supervisor";
      existingUser.state = cleanState;
      existingUser.lga = cleanLga;
      if (password) existingUser.password = password;
      existingUser.isSuspended = false;
      await existingUser.save({ validateBeforeSave: false });

      return res.status(200).json({
        success: true,
        message: `Existing user profile promoted to Field Supervisor for ${cleanLga} LGA, ${cleanState} State.`,
        data: existingUser,
      });
    }

    // 2. Raba Suna
    const names = name.trim().split(" ");
    const firstName = names[0] || "Field";
    const surname = names.slice(1).join(" ") || "Supervisor";

    // 3. Kirkiri Sabon Field Supervisor a Database
    const newSupervisor = await User.create({
      firstName,
      surname,
      name: name.toUpperCase().trim(),
      email: cleanEmail,
      phone: cleanPhone,
      password: password || "Password123@",
      pin: "2026",
      transactionPin: "2026",
      role: "supervisor",
      state: cleanState,
      lga: cleanLga,
      walletBalance: 0,
      balance: 0,
      isSuspended: false,
      isVerified: true,
      status: "active",
      assignedLeader: req.user?._id || null,
    });

    if (Activity && req.user?._id) {
      await Activity.create({
        staffId: req.user._id,
        user: req.user._id,
        action: "SUPERVISOR_ENROLLED",
        details: `State Manager appointed ${newSupervisor.name} as Field Supervisor for ${cleanLga} LGA, ${cleanState} State`,
        targetUser: newSupervisor._id,
      }).catch(() => {});
    }

    return res.status(201).json({
      success: true,
      message: `Supervisor ${newSupervisor.name} successfully deployed to ${cleanLga} LGA!`,
      data: newSupervisor,
    });
  } catch (error) {
    console.error("Create Supervisor Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create supervisor account.",
    });
  }
};

// Aliases domin kar a samu 'handler not implemented'
exports.createSupervisor = exports.appointStateLeader;
exports.appointManager = exports.appointStateLeader;
exports.appointSupervisor = exports.appointStateLeader;

// @desc    Leader & State Manager Dashboard Data
// @route   GET /api/v1/leader/dashboard
exports.getSuperLeaderDashboard = async (req, res) => {
  try {
    const user = await User.findById(req.user?._id || req.user?.id);
    const myState = user?.state || "Kano";
    const stateRegex = new RegExp(`^${myState.trim()}$`, "i");

    // 1. Kwaso dukkan Supervisors na jihar
    const supervisors = await User.find({
      role: { $in: ["supervisor", "field_supervisor"] },
      state: stateRegex,
    })
      .select("-password -pin -transactionPin")
      .sort({ createdAt: -1 })
      .lean();

    // 2. Kwaso dukkan Agents na jihar
    const agents = await User.find({
      role: "agent",
      state: stateRegex,
    })
      .select("-password -pin -transactionPin")
      .sort({ createdAt: -1 })
      .lean();

    // 3. Lissafa ainihin Data da Airtime da aka sayar a jihar (Real Sales)
    let actualStateDataSold = 0;
    let actualStateAirtimeSold = 0;

    const supervisorsWithTeam = supervisors.map((sup) => {
      const team = agents.filter(
        (a) =>
          String(a.assignedSupervisor) === String(sup._id) ||
          (a.lga && sup.lga && a.lga.toLowerCase() === sup.lga.toLowerCase())
      );

      const supDataSold = Number(sup.dataVolumeSold || sup.dataSold || 0);
      const supAirtimeSold = Number(sup.airtimeSold || 0);

      actualStateDataSold += supDataSold;
      actualStateAirtimeSold += supAirtimeSold;

      return {
        ...sup,
        teamSize: team.length,
        agentsCount: team.length,
        dataGoal: sup.targets?.dataGoal || 0,
        airtimeGoal: sup.targets?.airtimeGoal || 0,
        agentGoal: sup.targets?.agentGoal || 10,
        dataSold: supDataSold,
        airtimeSold: supAirtimeSold,
      };
    });

    // Tara tallace-tallacen agents da basu da supervisor
    agents.forEach((ag) => {
      if (!ag.assignedSupervisor) {
        actualStateDataSold += Number(ag.dataVolumeSold || ag.dataSold || 0);
        actualStateAirtimeSold += Number(ag.airtimeSold || 0);
      }
    });

    // 4. Activity logs
    let activityLogs = [];
    if (Activity) {
      activityLogs = await Activity.find({
        $or: [{ state: stateRegex }, { user: user._id }],
      })
        .sort({ createdAt: -1 })
        .limit(25)
        .lean();
    }

    return res.status(200).json({
      success: true,
      status: "success",
      data: {
        state: myState,
        supervisors: supervisorsWithTeam,
        agents,
        activityLogs,
        myTargets: user?.targets || {},
        networkStats: {
          totalSupervisors: supervisors.length,
          totalAgents: agents.length,
          overallDataSold: actualStateDataSold, // Yanzu zai dawo 0 GB idan ba a sayar ba
          overallAirtimeSold: actualStateAirtimeSold,
        },
      },
    });
  } catch (error) {
    console.error("Dashboard Sync Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load dashboard telemetry.",
      error: error.message,
    });
  }
};

// @desc    Get Active Retail Agents Stream for State
// @route   GET /api/v1/leader/agents-stream
exports.getAgentsStream = async (req, res) => {
  try {
    const user = await User.findById(req.user?._id || req.user?.id);
    const myState = user?.state || "Kano";
    const stateRegex = new RegExp(`^${myState.trim()}$`, "i");

    const agents = await User.find({
      role: "agent",
      state: stateRegex,
    })
      .select("-password -pin -transactionPin")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: agents.length,
      agents,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get State Operational Audit Logs Stream
// @route   GET /api/v1/leader/live-audit-stream
exports.getLiveAuditStream = async (req, res) => {
  try {
    const user = await User.findById(req.user?._id || req.user?.id);
    const myState = user?.state || "Kano";
    const stateRegex = new RegExp(`^${myState.trim()}$`, "i");

    let logs = [];
    if (Activity) {
      logs = await Activity.find({
        $or: [{ state: stateRegex }, { user: user._id }],
      })
        .sort({ createdAt: -1 })
        .limit(50)
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
// @desc    Assign / Deploy Targets to Supervisors, Agents, or LGAs (Single, Multi, or Auto-Split)
// @route   POST /api/v1/leader/assign-target OR POST /api/v1/leader/deploy-targets
exports.assignStateLeaderTarget = async (req, res) => {
  try {
    const {
      category,
      supervisorIds = [],
      agentIds = [],
      dataGoal,
      airtimeGoal,
      agentGoal,
      month,
      targetMonth,
      state,
      lgas = [],
    } = req.body;

    const actorId = req.user?._id || req.user?.id;
    const finalMonth = month || targetMonth || "August 2026";
    const dGoal = Number(dataGoal) || 0;
    const aGoal = Number(airtimeGoal) || 0;
    const agGoal = Number(agentGoal) || 0;

    const targetPayload = {
      dataGoal: dGoal,
      airtimeGoal: aGoal,
      agentGoal: agGoal,
      currentMonth: finalMonth,
      assignedBy: actorId,
    };

    let targetIds = [];
    if (Array.isArray(supervisorIds) && supervisorIds.length > 0) {
      targetIds = [...supervisorIds];
    }
    if (Array.isArray(agentIds) && agentIds.length > 0) {
      targetIds = [...targetIds, ...agentIds];
    }

    // 1. Idan an tura takamaiman mutane ta hanyar ID (Auto-Split ko Checkbox)
    if (targetIds.length > 0) {
      await User.updateMany(
        { _id: { $in: targetIds } },
        { $set: { targets: targetPayload } }
      );
    }

    // 2. Idan an tura ta hanyar LGAs
    if (Array.isArray(lgas) && lgas.length > 0) {
      await User.updateMany(
        {
          state: new RegExp(`^${(state || req.user?.state || "Kano").trim()}$`, "i"),
          lga: { $in: lgas },
          role: { $in: ["supervisor", "agent"] },
        },
        { $set: { targets: targetPayload } }
      );
    }

    // 3. Log Activity
    if (Activity && actorId) {
      await Activity.create({
        staffId: actorId,
        user: actorId,
        action: "FIELD_TARGETS_DEPLOYED",
        details: `State Manager allocated quota (${dGoal}GB Data & ₦${aGoal} Airtime) to ${targetIds.length || lgas.length} recipients`,
      }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: `Targets successfully deployed for ${finalMonth}.`,
      data: targetPayload,
    });
  } catch (error) {
    console.error("Assign Target Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to deploy target quota.",
    });
  }
};

// Aliases don tabbatar da kowace hanya ta gane shi
exports.deployStateTargets = exports.assignStateLeaderTarget;
exports.assignTarget = exports.assignStateLeaderTarget;