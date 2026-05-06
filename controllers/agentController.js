const mongoose = require("mongoose");
const User = require("../models/User");
const Sale = require("../models/Sale");

// 1. Get Agent performance
exports.getAgentPerformance = async (req, res) => {
  try {
    const agentId = req.user._id;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Amfani da mongoose.Types.ObjectId ba tare da "new" ba idan ya zama dole
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

    const performance =
      monthlySales.length > 0
        ? monthlySales[0]
        : { totalGB: 0, totalSalesValue: 0 };

    res.status(200).json({ success: true, data: performance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Get Sales History
exports.getAgentSalesHistory = async (req, res) => {
  try {
    const sales = await Sale.find({ agentId: req.user._id }).sort("-createdAt");
    res.status(200).json({ success: true, data: sales });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. Get Supervisor Info
exports.getMySupervisor = async (req, res) => {
  try {
    // MUHIMMI: Tabbatar field din a User Model sunansa "assignedSupervisor" ko "supervisorId"
    const agent = await User.findById(req.user._id).populate(
      "assignedSupervisor",
      "name phone",
    );

    // Idan baka tabbatar da sunan field din ba, duba User Model dinka
    const supervisor =
      agent.assignedSupervisor ||
      agent.supervisorId ||
      "No supervisor assigned";

    res.status(200).json({ success: true, data: supervisor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. Placeholders don kariya daga crash
exports.createAgent = async (req, res) => {
  res.status(201).json({ success: true, message: "Agent creation endpoint" });
};

exports.getAgents = async (req, res) => {
  try {
    const agents = await User.find({ role: "agent" }).select(
      "name email phone",
    );
    res.status(200).json({ success: true, data: agents });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
