const User = require("../models/User");
const Activity = require("../models/Activity");
let TargetHistory;
try {
  TargetHistory = require("../models/TargetHistory");
} catch (e) {
  TargetHistory = null;
}
let Transaction;
try {
  Transaction = require("../models/Transaction");
} catch (e) {
  Transaction = null;
}
const { NIGERIA_STATES_LGAS, ALL_NIGERIAN_STATES } = require("../utils/nigeriaGeoData");

// @desc    National Field Overview (36 Jihohi + FCT, Managers, Supervisors, Agents, Data & Airtime Volumes)
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

    // 3. Kididdige kowace Jiha a Matrix (Data + Airtime Sales)
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

        let stateDataVolume = 0;
        let stateAirtimeVolume = 0;

        try {
          if (Transaction) {
            const stateUsers = await User.find({ state: stateName }).select("_id").lean();
            const userIds = stateUsers.map((u) => u._id);

            // Binciko Data Sales
            const dataAgg = await Transaction.aggregate([
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
            stateDataVolume = dataAgg[0]?.totalVolume || 0;

            // Binciko Airtime Sales
            const airtimeAgg = await Transaction.aggregate([
              {
                $match: {
                  user: { $in: userIds },
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
            stateAirtimeVolume = airtimeAgg[0]?.totalAmount || 0;
          }
        } catch (e) {
          stateDataVolume = manager?.walletBalance || 0;
          stateAirtimeVolume = 0;
        }

        const tg = manager?.targets || {};

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
          targetMonth: tg.currentMonth || "August 2026",
          stateDataGoal: tg.dataGoal || 0,
          stateAirtimeGoal: tg.airtimeGoal || 0,
          stateSupervisorGoal: tg.supervisorGoal || lgasCount,
          stateVolumeSold: stateDataVolume,
          stateAirtimeSold: stateAirtimeVolume,
        };
      })
    );

    const nationalVolumeSold = statesMatrix.reduce((acc, curr) => acc + (curr.stateVolumeSold || 0), 0);
    const nationalAirtimeSold = statesMatrix.reduce((acc, curr) => acc + (curr.stateAirtimeSold || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        nationalStats: {
          totalStates: ALL_NIGERIAN_STATES.length,
          activeManagers: stateManagers.length,
          totalSupervisors,
          totalAgents,
          nationalVolumeSold,
          nationalAirtimeSold,
        },
        statesMatrix,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    NSD Assigns / Edits / Clears State Targets (Graceful handling for Single, Multi-Select, or All 36 States)
exports.assignStateLeaderTarget = async (req, res) => {
  try {
    const {
      mode,
      leaderId,
      state,
      states,
      selectedScope,
      selectedState,
      selectedStates = [],
      dataGoal,
      dataVolumeQuota,
      airtimeGoal,
      airtimeSalesQuota,
      agentGoal,
      agentsQuota,
      supervisorGoal,
      supervisorsQuota,
      month,
      targetCycle,
    } = req.body;

    const actorId = req.user?._id || req.user?.id || null;
    const targetMonth = month || targetCycle || "August 2026";
    const finalDataGoal = Number(dataVolumeQuota !== undefined ? dataVolumeQuota : dataGoal) || 0;
    const finalAirtimeGoal = Number(airtimeSalesQuota !== undefined ? airtimeSalesQuota : airtimeGoal) || 0;
    const finalSupervisorGoal = Number(supervisorsQuota !== undefined ? supervisorsQuota : supervisorGoal) || 0;
    const finalAgentGoal = Number(agentsQuota !== undefined ? agentsQuota : agentGoal) || 0;

    // 1. Tattara dukkan jihohin da aka zaba
    let targetStatesList = [];

    if (selectedScope === "ALL" || selectedScope === "all_states" || mode === "all") {
      targetStatesList = [...ALL_NIGERIAN_STATES];
    } else if (Array.isArray(selectedStates) && selectedStates.length > 0) {
      targetStatesList = selectedStates;
    } else if (Array.isArray(states) && states.length > 0) {
      targetStatesList = states;
    } else if (selectedState) {
      targetStatesList = [selectedState];
    } else if (state) {
      targetStatesList = [state];
    }

    if (targetStatesList.length === 0 && !leaderId) {
      return res.status(400).json({
        success: false,
        message: "Please select at least one state or State Manager.",
      });
    }

    const targetPayload = {
      dataGoal: finalDataGoal,
      airtimeGoal: finalAirtimeGoal,
      supervisorGoal: finalSupervisorGoal,
      agentGoal: finalAgentGoal,
      currentMonth: targetMonth,
      assignedByNsd: actorId,
    };

    // 2. Aiwatarwa idan an zabi takamaiman Jihohi (Single ko Multi-State)
    if (targetStatesList.length > 0) {
      for (const st of targetStatesList) {
        const cleanState = String(st).trim();
        const stateRegex = new RegExp(`^${cleanState}$`, "i");

        // Nemo State Manager na jihar idan akwai
        const managers = await User.find({
          role: { $in: ["state_manager", "leader", "supervisor"] },
          state: stateRegex,
        });

        if (managers.length > 0) {
          for (const mgr of managers) {
            mgr.targets = { ...targetPayload, state: mgr.state || cleanState };
            mgr.markModified("targets");
            await mgr.save({ validateBeforeSave: false });

            if (TargetHistory && actorId) {
              await TargetHistory.create({
                assignedTo: mgr._id,
                assignedBy: actorId,
                dataGoal: finalDataGoal,
                airtimeGoal: finalAirtimeGoal,
                supervisorGoal: finalSupervisorGoal,
                month: targetMonth,
                state: cleanState,
              }).catch(() => {});
            }
          }
        }
      }

      if (actorId) {
        await Activity.create({
          staffId: actorId,
          user: actorId,
          action: "STATE_TARGETS_DEPLOYED",
          details: `NSD deployed target quota (${finalDataGoal} GB & ₦${finalAirtimeGoal}) across ${targetStatesList.length} state(s) for ${targetMonth}`,
        }).catch(() => {});
      }

      return res.status(200).json({
        success: true,
        message: `Targets successfully deployed across ${targetStatesList.length} State(s)`,
        deployedStates: targetStatesList,
      });
    }

    // 3. Aiwatarwa ta hanyar Direct `leaderId`
    if (leaderId) {
      const manager = await User.findById(leaderId);
      if (!manager) {
        return res.status(404).json({ success: false, message: "State Manager not found" });
      }

      manager.targets = { ...targetPayload, state: manager.state };
      manager.markModified("targets");
      await manager.save({ validateBeforeSave: false });

      if (TargetHistory && actorId) {
        await TargetHistory.create({
          assignedTo: manager._id,
          assignedBy: actorId,
          dataGoal: finalDataGoal,
          airtimeGoal: finalAirtimeGoal,
          supervisorGoal: finalSupervisorGoal,
          month: targetMonth,
          state: manager.state,
        }).catch(() => {});
      }

      if (actorId) {
        await Activity.create({
          staffId: actorId,
          user: actorId,
          action: "STATE_TARGET_DEPLOYED",
          details: `NSD allocated target quota (${finalDataGoal} GB & ₦${finalAirtimeGoal}) for ${manager.name} (${manager.state} State)`,
          targetUser: manager._id,
        }).catch(() => {});
      }

      return res.status(200).json({
        success: true,
        message: `Targets successfully updated for ${manager.state} State`,
        targets: manager.targets,
      });
    }

    return res.status(400).json({
      success: false,
      message: "Target allocation could not be completed. Invalid payload.",
    });
  } catch (error) {
    console.error("Assign State Target Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error during target deployment",
      error: error.message,
    });
  }
};

// @desc    NSD Toggles Suspension for State Managers ko Staff (Suspend / Reactivate)
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

    if (staff.role === "superadmin" || (req.user?._id && staff._id.toString() === req.user._id.toString())) {
      return res.status(403).json({
        success: false,
        message: "You cannot suspend this executive account",
      });
    }

    staff.isSuspended = !staff.isSuspended;
    await staff.save({ validateBeforeSave: false });

    const actionType = staff.isSuspended ? "STAFF_SUSPENDED" : "STAFF_UNSUSPENDED";
    const statusText = staff.isSuspended ? "SUSPENDED" : "ACTIVATED";

    if (req.user?._id) {
      await Activity.create({
        staffId: req.user._id,
        action: actionType,
        details: `NSD changed operational access for ${staff.name} (${staff.role.toUpperCase()} - ${staff.state || "National"}) to ${statusText}`,
        targetUser: staff._id,
      }).catch(() => {});
    }

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
        message: "A user with this phone number or email already exists",
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
      assignedLeader: req.user?._id || null,
    });

    if (req.user?._id) {
      await Activity.create({
        staffId: req.user._id,
        action: "STATE_MANAGER_APPOINTED",
        details: `NSD officially appointed ${newManager.name} as State Manager for ${cleanState} State`,
        targetUser: newManager._id,
      }).catch(() => {});
    }

    res.status(201).json({
      success: true,
      message: `State Manager for ${cleanState} successfully appointed`,
      data: newManager,
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// @desc    Download 36 States Executive Audit Report as CSV
exports.downloadNationalReport = async (req, res) => {
  try {
    const managers = await User.find({
      role: { $in: ["state_manager", "leader"] },
    }).lean();

    let csvHeader = "State,Manager Name,Phone,Email,Data Goal (GB),Airtime Goal (NGN),Supervisor Goal,Status\n";
    let csvRows = managers
      .map((m) => {
        const tg = m.targets || {};
        return `"${m.state || "N/A"}","${m.name || m.phone}","${m.phone}","${m.email}",${tg.dataGoal || 0},${tg.airtimeGoal || 0},${tg.supervisorGoal || 0},"${m.isSuspended ? "Suspended" : "Active"}"`;
      })
      .join("\n");

    const csvData = csvHeader + csvRows;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=NSD-36States-Performance-Report.csv`);
    return res.status(200).send(csvData);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};