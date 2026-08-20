const DataPlan = require("../models/DataPlan");
const axios = require("axios");

const AYAX_API_BASE_URL =
  process.env.AYAX_API_BASE_URL ||
  "https://ayax-api-marketplace.onrender.com/api/v1";
const AYAX_API_KEY = process.env.AYAX_API_KEY;

// 1. Get all plans for admin dashboard
const getAdminPlans = async (req, res) => {
  try {
    const plans = await DataPlan.find().sort({
      networkName: 1,
      userPrice: 1,
    });

    return res.status(200).json({
      success: true,
      count: plans.length,
      data: plans,
      plans,
    });
  } catch (error) {
    console.error("Get Admin Plans Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching admin plans",
      error: error.message,
    });
  }
};

// 2. Set or Update Plan Price
const setPlanPrice = async (req, res) => {
  const {
    networkId,
    planCode,
    userPrice,
    agentPrice,
    planLabel,
    networkName,
    sizeGB,
    planType,
    validity,
  } = req.body;

  if (
    !networkId ||
    !planCode ||
    userPrice === undefined ||
    agentPrice === undefined
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Please provide all required fields (networkId, planCode, userPrice, agentPrice)",
    });
  }

  try {
    const plan = await DataPlan.findOneAndUpdate(
      { networkId: String(networkId), planCode: String(planCode) },
      {
        userPrice: Number(userPrice),
        agentPrice: Number(agentPrice),
        planLabel,
        networkName,
        sizeGB: sizeGB ? Number(sizeGB) : 0,
        planType,
        validity,
        isActive: true,
      },
      { upsert: true, new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: "Plan updated successfully",
      plan,
    });
  } catch (error) {
    console.error("Set Plan Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating plan details",
      error: error.message,
    });
  }
};

// 3. Sync Plans from Ayax API Marketplace
const syncAyaxPlans = async (req, res) => {
  try {
    const response = await axios.get(`${AYAX_API_BASE_URL}/data/plans`, {
      headers: {
        "x-api-key": AYAX_API_KEY,
        Authorization: `Bearer ${AYAX_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    const resData = response.data;
    const plansList = resData.data || resData.plans || resData;

    if (!Array.isArray(plansList) || plansList.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No plans returned from Ayax API provider",
      });
    }

    let syncedCount = 0;

    for (const p of plansList) {
      const netId = String(
        p.networkId || p.network || p.network_id || p.serviceCode || ""
      );
      const pCode = String(p.planCode || p.plan_code || p.id || p.code || "");
      const pLabel = p.planLabel || p.name || p.title || p.description;
      const netName = p.networkName || p.network_name || p.network;
      const apiPrice = Number(p.price || p.amount || p.apiPrice || 0);

      if (netId && pCode) {
        await DataPlan.findOneAndUpdate(
          { networkId: netId, planCode: pCode },
          {
            $setOnInsert: {
              userPrice: apiPrice + 50,
              agentPrice: apiPrice + 20,
              isActive: true,
            },
            planLabel: pLabel,
            networkName: netName,
            sizeGB: Number(p.sizeGB || p.size || 0),
            planType: p.planType || p.type || "SME",
            validity: p.validity || "30 Days",
          },
          { upsert: true, new: true }
        );
        syncedCount++;
      }
    }

    return res.status(200).json({
      success: true,
      message: `Successfully synchronized ${syncedCount} plans from Ayax APIs`,
    });
  } catch (error) {
    console.error("Sync Plans Error:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to sync plans from Ayax APIs",
      error: error.response?.data?.message || error.message,
    });
  }
};

// 4. Toggle Plan Status
const togglePlanStatus = async (req, res) => {
  try {
    const plan = await DataPlan.findById(req.params.id);
    if (!plan) {
      return res
        .status(404)
        .json({ success: false, message: "Plan not found" });
    }

    plan.isActive = !plan.isActive;
    await plan.save();

    return res.status(200).json({
      success: true,
      message: `Plan status changed to ${plan.isActive ? "Active" : "Inactive"}`,
      data: plan,
    });
  } catch (error) {
    console.error("Toggle Plan Status Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error toggling plan status",
      error: error.message,
    });
  }
};

// 5. Delete Plan
const deletePlan = async (req, res) => {
  try {
    const plan = await DataPlan.findByIdAndDelete(req.params.id);
    if (!plan) {
      return res
        .status(404)
        .json({ success: false, message: "Plan not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Data plan deleted successfully",
    });
  } catch (error) {
    console.error("Delete Plan Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error deleting plan",
      error: error.message,
    });
  }
};

// 6. Get Active Plans for Users
const getPlans = async (req, res) => {
  try {
    const plans = await DataPlan.find({ isActive: true }).sort({
      networkName: 1,
      userPrice: 1,
    });

    return res.status(200).json({
      success: true,
      count: plans.length,
      data: plans,
    });
  } catch (error) {
    console.error("Get Plans Error:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching plans",
      error: error.message,
    });
  }
};

module.exports = {
  getAdminPlans,
  getPlans,
  setPlanPrice,
  syncAyaxPlans,
  togglePlanStatus,
  deletePlan,
};