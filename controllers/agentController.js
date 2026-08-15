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
    res.status(200).json({ success: true, count: sales.length, data: sales });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. Get Supervisor Info
exports.getMySupervisor = async (req, res) => {
  try {
    const agent = await User.findById(req.user._id).populate(
      "assignedSupervisor supervisorId",
      "surname firstName name phone email"
    );

    if (!agent) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    const supervisor =
      agent.assignedSupervisor ||
      agent.supervisorId ||
      null;

    if (!supervisor) {
      return res.status(200).json({ success: true, data: null, message: "No supervisor assigned" });
    }

    res.status(200).json({ success: true, data: supervisor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. Create Agent Endpoint
exports.createAgent = async (req, res) => {
  try {
    const { surname, firstName, email, phone, password, supervisorId } = req.body;

    if (!email || !password || !phone) {
      return res.status(400).json({ success: false, message: "Please provide all required fields" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "User with this email already exists" });
    }

    const newAgent = await User.create({
      surname,
      firstName,
      email,
      phone,
      password,
      role: "agent",
      supervisorId: supervisorId || null,
      assignedSupervisor: supervisorId || null,
    });

    res.status(201).json({
      success: true,
      message: "Agent created successfully",
      data: {
        id: newAgent._id,
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
      .select("-password")
      .sort("-createdAt");
    res.status(200).json({ success: true, count: agents.length, data: agents });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 6. Record New Sale (Ƙarin taimako don sauƙaƙe aikin agent)
exports.recordSale = async (req, res) => {
  try {
    const { dataAmountGB, amount, customerPhone } = req.body;
    const agentId = req.user._id;

    if (!dataAmountGB || !amount) {
      return res.status(400).json({ success: false, message: "Data amount and price are required" });
    }

    const newSale = await Sale.create({
      agentId,
      dataAmountGB: Number(dataAmountGB),
      amount: Number(amount),
      customerPhone: customerPhone || "",
    });

    res.status(201).json({
      success: true,
      message: "Sale recorded successfully",
      data: newSale,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};