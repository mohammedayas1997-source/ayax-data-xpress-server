const mongoose = require("mongoose");
const User = require("../models/User");

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

// 1. Get Agent Real-Time Performance & Quota Targets (Data + Airtime)
exports.getAgentPerformance = async (req, res) => {
  try {
    const agentId = req.user._id;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    let totalGB = 0;
    let totalSalesValue = 0;
    let airtimeSalesValue = 0;
    let commissionsEarned = 0;
    let bonusEarned = 0;

    // Binciko dukkan tallace-tallace daga Transaction collection
    if (Transaction) {
      const stats = await Transaction.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(agentId),
            status: { $in: ["successful", "success", "completed"] },
            createdAt: { $gte: startOfMonth },
          },
        },
        {
          $group: {
            _id: "$type",
            totalVolume: { $sum: { $ifNull: ["$dataSize", "$volume", 0] } },
            totalAmount: { $sum: "$amount" },
            commission: { $sum: { $ifNull: ["$commission", "$profit", 0] } },
          },
        },
      ]);

      stats.forEach((st) => {
        commissionsEarned += st.commission;
        if (st._id === "data" || st._id === "DATA") {
          totalGB += st.totalVolume || st.totalAmount;
          totalSalesValue += st.totalAmount;
        } else if (st._id === "airtime" || st._id === "AIRTIME" || st._id === "vtu" || st._id === "VTU") {
          airtimeSalesValue += st.totalAmount;
          totalSalesValue += st.totalAmount;
        } else {
          totalSalesValue += st.totalAmount;
        }
      });
    } else if (Sale) {
      const monthlySales = await Sale.aggregate([
        {
          $match: {
            agentId: new mongoose.Types.ObjectId(agentId),
            createdAt: { $gte: startOfMonth },
          },
        },
        {
          $group: {
            _id: null,
            totalGB: { $sum: "$dataAmountGB" },
            totalSalesValue: { $sum: "$amount" },
          },
        },
      ]);

      if (monthlySales.length > 0) {
        totalGB = monthlySales[0].totalGB || 0;
        totalSalesValue = monthlySales[0].totalSalesValue || 0;
      }
    }

    const agentUser = await User.findById(agentId).select("targets walletBalance balance").lean();
    const tg = agentUser?.targets || {};

    const performance = {
      totalGB,
      totalSalesValue,
      airtimeSalesValue,
      commissionsEarned: commissionsEarned || Number(agentUser?.walletBalance || 0) * 0.05,
      bonusEarned: bonusEarned || 0,
      monthlyTargetSales: tg.airtimeGoal || 100000,
      monthlyTargetGB: tg.dataGoal || 100,
      currentMonth: tg.currentMonth || "August 2026",
    };

    res.status(200).json({ success: true, data: performance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Get Sales & Transactions History
exports.getAgentSalesHistory = async (req, res) => {
  try {
    const agentId = req.user._id;

    if (Transaction) {
      const transactions = await Transaction.find({ user: agentId })
        .sort("-createdAt")
        .limit(100)
        .lean();

      return res.status(200).json({
        success: true,
        count: transactions.length,
        data: transactions,
      });
    }

    if (Sale) {
      const sales = await Sale.find({ agentId }).sort("-createdAt").lean();
      return res.status(200).json({ success: true, count: sales.length, data: sales });
    }

    res.status(200).json({ success: true, count: 0, data: [] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. Get Assigned Supervisor Details
exports.getMySupervisor = async (req, res) => {
  try {
    const agent = await User.findById(req.user._id)
      .populate("assignedSupervisor supervisorId", "name firstName surname phone email state lga")
      .lean();

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    let supervisor = agent.assignedSupervisor || agent.supervisorId || null;

    // Idan babu direct link, nemo supervisor na wannan LGA da Jihar
    if (!supervisor && agent.lga && agent.state) {
      supervisor = await User.findOne({
        role: { $in: ["supervisor", "field_supervisor"] },
        state: agent.state,
        lga: agent.lga,
      }).select("name firstName surname phone email state lga").lean();
    }

    if (!supervisor) {
      return res.status(200).json({
        success: true,
        data: {
          name: "Field Operations Desk",
          phone: "08000000000",
          state: agent.state || "Kano",
          lga: agent.lga || "Central",
        },
      });
    }

    res.status(200).json({
      success: true,
      data: {
        _id: supervisor._id,
        name: supervisor.name || `${supervisor.firstName || ""} ${supervisor.surname || ""}`.trim(),
        phone: supervisor.phone,
        email: supervisor.email,
        state: supervisor.state,
        lga: supervisor.lga,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. Register New Agent (With Supervisor Referral / LGA Link)
exports.createAgent = async (req, res) => {
  try {
    const {
      surname,
      firstName,
      name,
      email,
      phone,
      password,
      supervisorId,
      referralCode,
      state,
      lga,
    } = req.body;

    if (!phone || (!name && (!firstName || !surname))) {
      return res.status(400).json({ success: false, message: "Name and Phone Number are required" });
    }

    const cleanPhone = phone.trim();
    const cleanEmail = email ? email.toLowerCase().trim() : `${cleanPhone}@ayaxdata.online`;

    const existingUser = await User.findOne({
      $or: [{ phone: cleanPhone }, { email: cleanEmail }],
    });

    if (existingUser) {
      return res.status(400).json({ success: false, message: "User with this phone or email already exists" });
    }

    // Gano Supervisor ta ID ko Referral Code
    let assignedSupId = supervisorId || null;
    if (!assignedSupId && referralCode) {
      const supUser = await User.findOne({
        $or: [
          { referralId: referralCode.trim() },
          { phone: referralCode.trim() },
        ],
        role: { $in: ["supervisor", "field_supervisor"] },
      });
      if (supUser) assignedSupId = supUser._id;
    }

    const finalFirstName = firstName || (name ? name.split(" ")[0] : "Retail");
    const finalSurname = surname || (name ? name.split(" ").slice(1).join(" ") : "Agent");

    const newAgent = await User.create({
      firstName: finalFirstName,
      surname: finalSurname,
      name: (name || `${finalFirstName} ${finalSurname}`).toUpperCase().trim(),
      email: cleanEmail,
      phone: cleanPhone,
      password: password || "Password123@",
      pin: "2026",
      transactionPin: "2026",
      role: "agent",
      state: state || req.user?.state || "Kano",
      lga: lga || req.user?.lga || "Central",
      supervisorId: assignedSupId,
      assignedSupervisor: assignedSupId,
      walletBalance: 0,
      balance: 0,
      isVerified: true,
      status: "active",
      targets: {
        dataGoal: 100,
        airtimeGoal: 10000,
        currentMonth: "August 2026",
      },
    });

    res.status(201).json({
      success: true,
      message: "Agent registered successfully",
      data: {
        id: newAgent._id,
        name: newAgent.name,
        email: newAgent.email,
        phone: newAgent.phone,
        role: newAgent.role,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 5. Get Agents List
exports.getAgents = async (req, res) => {
  try {
    const agents = await User.find({ role: "agent" })
      .populate("assignedSupervisor", "name phone lga")
      .select("-password")
      .sort("-createdAt")
      .lean();

    res.status(200).json({ success: true, count: agents.length, data: agents });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 6. Record New Sale
exports.recordSale = async (req, res) => {
  try {
    const { dataAmountGB, amount, type, customerPhone } = req.body;
    const agentId = req.user._id;

    if (!amount) {
      return res.status(400).json({ success: false, message: "Sale amount is required" });
    }

    let record;
    if (Sale) {
      record = await Sale.create({
        agentId,
        dataAmountGB: Number(dataAmountGB) || 0,
        amount: Number(amount),
        customerPhone: customerPhone || "",
      });
    }

    res.status(201).json({
      success: true,
      message: "Sale recorded successfully",
      data: record || { agentId, amount, dataAmountGB },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};