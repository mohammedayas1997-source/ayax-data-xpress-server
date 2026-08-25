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

// 1. Get Leader Dashboard Data
exports.getLeaderDashboard = async (req, res) => {
  try {
    const leaderId = req.user._id;
    const leaderState = req.user.state || req.query.state || "";

    const supervisorQuery = {
      role: { $in: ["supervisor", "field_supervisor"] },
      $or: [
        { assignedLeader: leaderId },
        ...(leaderState ? [{ state: new RegExp(`^${leaderState}$`, "i") }] : []),
      ],
    };

    const supervisors = await User.find(supervisorQuery).lean();
    let totalAgentsCount = 0;
    let totalStateVolumeSold = 0;

    const supDetails = await Promise.all(
      supervisors.map(async (sup) => {
        const agents = await User.find({
          role: "agent",
          $or: [
            { assignedSupervisor: sup._id },
            { lga: sup.lga, state: sup.state }
          ],
        }).select("_id name phone walletBalance balance state lga").lean();

        const agentIds = agents.map((a) => a._id);
        totalAgentsCount += agents.length;

        let teamDataSold = 0;
        try {
          if (Transaction) {
            const salesAgg = await Transaction.aggregate([
              {
                $match: {
                  user: { $in: [sup._id, ...agentIds] },
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
            teamDataSold = salesAgg[0]?.totalVolume || 0;
          }
        } catch (err) {
          teamDataSold = sup.balance || 0;
        }

        totalStateVolumeSold += teamDataSold;

        return {
          id: sup._id,
          _id: sup._id,
          name: sup.name || `${sup.firstName || ""} ${sup.surname || ""}`.trim(),
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
          dataGoal: sup.targets?.dataGoal || 500,
          agentGoal: sup.targets?.agentGoal || 10,
          targetAssigned: Boolean(sup.targets?.dataGoal),
          targets: sup.targets || { dataGoal: 0, agentGoal: 0, currentMonth: "" },
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        leaderState: leaderState || "National",
        networkStats: {
          totalSupervisors: supervisors.length,
          totalAgents: totalAgentsCount,
          overallDataSold: totalStateVolumeSold,
          activeQuotas: supDetails.filter((s) => s.targetAssigned).length,
        },
        supervisors: supDetails,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Get Agents Stream
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

    const formattedAgents = agents.map((ag) => ({
      id: ag._id,
      _id: ag._id,
      name: ag.name || `${ag.firstName || ""} ${ag.surname || ""}`.trim(),
      phone: ag.phone,
      email: ag.email,
      state: ag.state || leaderState,
      lga: ag.lga || "Hub",
      walletBalance: ag.walletBalance || ag.balance || 0,
      balance: ag.balance || 0,
      assignedSupervisorName:
        ag.assignedSupervisor?.name ||
        `${ag.assignedSupervisor?.firstName || ""} ${ag.assignedSupervisor?.surname || ""}`.trim() ||
        "LGA Coordinator",
      totalSalesCount: ag.salesCount || 0,
      dataVolumeSold: ag.dataSold || 0,
    }));

    res.status(200).json({ success: true, count: formattedAgents.length, agents: formattedAgents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 3. Live Audit Stream
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

// 4. Get All Agents (Standard)
exports.getAllAgents = async (req, res) => {
  try {
    const agents = await User.find({ role: "agent" })
      .populate("assignedSupervisor", "name email phone")
      .select("-password")
      .lean();
    res.status(200).json({ success: true, count: agents.length, agents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 5. Create New Supervisor
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
      name: name || `${finalFirstName} ${finalSurname}`.toUpperCase(),
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
    });

    await Activity.create({
      staffId: req.user._id,
      action: "SUPERVISOR_ENROLLED",
      details: `Appointed ${newSup.name} as Supervisor for ${newSup.lga} LGA, ${newSup.state} State`,
      targetUser: newSup._id,
    });

    res.status(201).json({ success: true, message: "Supervisor appointed successfully", data: newSup });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// 6. Toggle Supervisor Status
exports.toggleSupervisorStatus = async (req, res) => {
  try {
    const supervisorId = req.params.supervisorId || req.params.id;
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

// 7. Assign Supervisor Target
exports.assignSupervisorTarget = async (req, res) => {
  try {
    const { supervisorId, dataGoal, agentGoal, month, state, lga } = req.body;

    if (!supervisorId) {
      return res.status(400).json({ success: false, message: "Please provide supervisorId" });
    }

    const supervisor = await User.findOne({
      _id: supervisorId,
      role: { $in: ["supervisor", "field_supervisor"] },
    });

    if (!supervisor) {
      return res.status(404).json({ success: false, message: "Supervisor not found" });
    }

    const currentTargets = supervisor.targets || {};
    const targetMonth = month || new Date().toLocaleString("en-US", { month: "long", year: "numeric" });

    supervisor.targets = {
      dataGoal: Number(dataGoal) || currentTargets.dataGoal || 0,
      agentGoal: Number(agentGoal) || currentTargets.agentGoal || 0,
      currentMonth: targetMonth,
      state: state || supervisor.state,
      lga: lga || supervisor.lga,
    };

    supervisor.assignedLeader = req.user._id;
    supervisor.markModified("targets");
    await supervisor.save();

    await TargetHistory.create({
      assignedTo: supervisorId,
      assignedBy: req.user._id,
      dataGoal: Number(dataGoal) || 0,
      agentGoal: Number(agentGoal) || 0,
      month: targetMonth,
      state: state || supervisor.state,
      lga: lga || supervisor.lga,
    });

    res.status(200).json({ success: true, message: "Target assigned successfully", targets: supervisor.targets });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 8. Assign Agent to Supervisor
exports.assignAgentToSupervisor = async (req, res) => {
  try {
    const { agentId, supervisorId } = req.body;
    const agent = await User.findOneAndUpdate(
      { _id: agentId, role: "agent" },
      { assignedSupervisor: supervisorId },
      { new: true }
    );
    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }
    res.status(200).json({ success: true, message: "Agent assigned successfully", agent });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 9. Download Supervisor Report (CSV)
exports.downloadSupervisorReport = async (req, res) => {
  try {
    const leaderState = req.user.state || "";
    const supervisors = await User.find({
      role: { $in: ["supervisor", "field_supervisor"] },
      ...(leaderState ? { state: new RegExp(`^${leaderState}$`, "i") } : {}),
    }).lean();

    let csvHeader = "Supervisor Name,Phone,Email,State,LGA,Target Month,Data Goal (GB),Agent Goal,Status\n";
    let csvRows = supervisors.map((s) => {
      const tg = s.targets || {};
      return `"${s.name || s.phone}","${s.phone}","${s.email}","${s.state || ""}","${s.lga || ""}","${tg.currentMonth || "N/A"}",${tg.dataGoal || 0},${tg.agentGoal || 0},"${s.isSuspended ? "Suspended" : "Active"}"`;
    }).join("\n");

    const csvData = csvHeader + csvRows;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=Supervisor-Report.csv`);
    return res.status(200).send(csvData);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};