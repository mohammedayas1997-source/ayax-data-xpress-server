const DataPlan = require("../models/DataPlan");
const axios = require("axios");

// 1. Ayax API Gateway Base Configuration
const RAW_URL =
  process.env.AYAX_API_BASE_URL ||
  process.env.MARKETPLACE_API_URL ||
  "https://ayax-api-marketplace.onrender.com";

const CLEAN_BASE = RAW_URL.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
const AYAX_API_BASE_URL = `${CLEAN_BASE}/api/v1`;

// ✅ Daidai (Dogaro da Render Environment kawai):
const AYAX_API_KEY = process.env.AYAX_API_KEY || process.env.MARKETPLACE_API_KEY;
// Ayax Standard API Headers
const getHeaders = () => ({
  "Content-Type": "application/json",
  "x-api-key": AYAX_API_KEY,
  Authorization: `Bearer ${AYAX_API_KEY}`,
});

/**
 * 1. GET ALL ACTIVE PLANS (Public / Mobile App Frontend)
 * Supports: ?network=MTN&planType=SME
 */
const getPlans = async (req, res) => {
  try {
    const { network, networkName, planType, type } = req.query;
    const targetNetwork = network || networkName;
    const targetType = planType || type;

    const filter = { isActive: { $ne: false } };

    if (targetNetwork && targetNetwork !== "all") {
      const netRegex = new RegExp(`^${String(targetNetwork).trim()}$`, "i");
      filter.$or = [
        { networkName: netRegex },
        { network: netRegex },
        { serviceId: netRegex },
      ];
    }

    if (targetType && targetType !== "all") {
      const typeRegex = new RegExp(`^${String(targetType).trim()}$`, "i");
      filter.planType = typeRegex;
    }

    const plans = await DataPlan.find(filter)
      .sort({
        networkName: 1,
        sizeGB: 1,
        userPrice: 1,
      })
      .lean();

    return res.status(200).json({
      success: true,
      status: "success",
      count: plans.length,
      data: plans,
      plans,
    });
  } catch (error) {
    console.error("Get Plans Frontend Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Failed to retrieve data plans.",
      error: error.message,
    });
  }
};

/**
 * 2. GET ALL PLANS FOR ADMIN DASHBOARD
 */
const getAdminPlans = async (req, res) => {
  try {
    const plans = await DataPlan.find()
      .sort({
        networkName: 1,
        sizeGB: 1,
        userPrice: 1,
      })
      .lean();

    return res.status(200).json({
      success: true,
      status: "success",
      count: plans.length,
      data: plans,
      plans,
    });
  } catch (error) {
    console.error("Get Admin Plans Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Error fetching admin data plans list.",
      error: error.message,
    });
  }
};

/**
 * 3. SET OR UPDATE PLAN PRICING & METRICS
 */
const setPlanPrice = async (req, res) => {
  const {
    id,
    networkId,
    planCode,
    planId,
    userPrice,
    agentPrice,
    costPrice,
    planLabel,
    name,
    networkName,
    network,
    sizeGB,
    planType,
    validity,
    isActive,
  } = req.body;

  try {
    let plan;
    const finalNetName = String(networkName || network || "MTN").toUpperCase().trim();
    const finalPlanCode = String(planCode || planId || "").trim();
    const finalLabel = planLabel || name || `${sizeGB || ""}GB Plan`;

    if (id) {
      plan = await DataPlan.findByIdAndUpdate(
        id,
        {
          ...(userPrice !== undefined && { userPrice: Number(userPrice) }),
          ...(agentPrice !== undefined && { agentPrice: Number(agentPrice) }),
          ...(costPrice !== undefined && { costPrice: Number(costPrice) }),
          ...(planLabel && { planLabel: finalLabel }),
          ...(name && { name: finalLabel }),
          ...(networkName && { networkName: finalNetName, network: finalNetName }),
          ...(sizeGB !== undefined && { sizeGB: Number(sizeGB) }),
          ...(planType && { planType }),
          ...(validity && { validity }),
          ...(isActive !== undefined && { isActive: Boolean(isActive) }),
        },
        { new: true, runValidators: true }
      );
    } else {
      if ((!networkId && !network) || !finalPlanCode || userPrice === undefined) {
        return res.status(400).json({
          success: false,
          status: "failed",
          message: "networkId/network, planCode/planId, and userPrice are required.",
        });
      }

      const netId = String(networkId || network || finalNetName).toUpperCase();

      plan = await DataPlan.findOneAndUpdate(
        {
          $or: [
            { networkId: netId, planCode: finalPlanCode },
            { network: finalNetName, planId: finalPlanCode },
          ],
        },
        {
          networkId: netId,
          planCode: finalPlanCode,
          planId: finalPlanCode,
          userPrice: Number(userPrice),
          agentPrice: Number(agentPrice !== undefined ? agentPrice : userPrice),
          costPrice: Number(costPrice || 0),
          planLabel: finalLabel,
          name: finalLabel,
          networkName: finalNetName,
          network: finalNetName,
          sizeGB: sizeGB ? Number(sizeGB) : 0,
          planType: planType || "SME",
          validity: validity || "30 Days",
          isActive: isActive !== undefined ? Boolean(isActive) : true,
        },
        { upsert: true, new: true, runValidators: true }
      );
    }

    return res.status(200).json({
      success: true,
      status: "success",
      message: "Data plan pricing updated successfully.",
      data: plan,
      plan,
    });
  } catch (error) {
    console.error("Set Plan Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Error updating plan pricing details.",
      error: error.message,
    });
  }
};

/**
 * 4. SYNC PLANS DIRECTLY FROM AYAX VTU API GATEWAY
 */
const syncAyaxPlans = async (req, res) => {
  try {
    let response;
    const candidateEndpoints = [
      `${AYAX_API_BASE_URL}/data/plans`,
      `${AYAX_API_BASE_URL}/plans`,
      `${AYAX_API_BASE_URL}/vtu/data-plans`,
      `${AYAX_API_BASE_URL}/data-plans`,
    ];

    for (const url of candidateEndpoints) {
      try {
        response = await axios.get(url, {
          headers: getHeaders(),
          timeout: 30000,
        });
        if (response.data) break;
      } catch (e) {
        if (url === candidateEndpoints[candidateEndpoints.length - 1]) throw e;
      }
    }

    const resData = response?.data;
    const plansList =
      resData?.data ||
      resData?.plans ||
      resData?.dataPlans ||
      (Array.isArray(resData) ? resData : []);

    if (!Array.isArray(plansList) || plansList.length === 0) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "No plans returned from Ayax API marketplace.",
      });
    }

    let syncedCount = 0;

    for (const p of plansList) {
      const netId = String(
        p.networkId || p.network_id || p.network || p.serviceId || ""
      ).toUpperCase();
      const pCode = String(
        p.planCode || p.plan_code || p.planId || p.id || p.code || ""
      );
      const netName = String(
        p.networkName || p.network_name || p.network || "MTN"
      ).toUpperCase();
      const pLabel =
        p.planLabel || p.name || p.title || p.description || `${p.sizeGB || ""}GB Plan`;
      const apiPrice = Number(
        p.costPrice || p.price || p.amount || p.apiPrice || 0
      );
      const sizeGB = Number(p.sizeGB || p.size || p.volume || 0);
      const planType = String(p.planType || p.type || "SME").toUpperCase();
      const validity = p.validity || "30 Days";

      if (netId && pCode) {
        await DataPlan.findOneAndUpdate(
          {
            $or: [
              { networkId: netId, planCode: pCode },
              { network: netName, planId: pCode },
            ],
          },
          {
            $setOnInsert: {
              userPrice: apiPrice > 0 ? apiPrice + 50 : 250,
              agentPrice: apiPrice > 0 ? apiPrice + 20 : 230,
              costPrice: apiPrice,
              isActive: true,
            },
            $set: {
              networkId: netId,
              planCode: pCode,
              planId: pCode,
              networkName: netName,
              network: netName,
              planLabel: pLabel,
              name: pLabel,
              sizeGB: sizeGB,
              planType: planType,
              validity: validity,
            },
          },
          { upsert: true, new: true }
        );
        syncedCount++;
      }
    }

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Successfully synchronized ${syncedCount} plans from Ayax API Marketplace.`,
      syncedCount,
    });
  } catch (error) {
    console.error(
      "Sync Ayax Plans Error:",
      error.response?.status,
      error.response?.data || error.message
    );
    return res.status(error.response?.status || 500).json({
      success: false,
      status: "failed",
      message: "Failed to sync plans with Ayax Gateway.",
      error: error.response?.data?.message || error.message,
    });
  }
};

/**
 * 5. TOGGLE PLAN ACTIVE STATUS
 */
const togglePlanStatus = async (req, res) => {
  try {
    const plan = await DataPlan.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Data plan not found.",
      });
    }

    plan.isActive = !plan.isActive;
    await plan.save();

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Plan marked as ${plan.isActive ? "Active" : "Disabled"}.`,
      data: plan,
      plan,
    });
  } catch (error) {
    console.error("Toggle Plan Status Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Error toggling plan activation state.",
      error: error.message,
    });
  }
};

/**
 * 6. DELETE PLAN
 */
const deletePlan = async (req, res) => {
  try {
    const plan = await DataPlan.findByIdAndDelete(req.params.id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        status: "failed",
        message: "Data plan not found.",
      });
    }

    return res.status(200).json({
      success: true,
      status: "success",
      message: "Data plan deleted successfully.",
    });
  } catch (error) {
    console.error("Delete Plan Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Error deleting plan from database.",
      error: error.message,
    });
  }
};

module.exports = {
  getPlans,
  getDataPlans: getPlans,
  getAdminPlans,
  setPlanPrice,
  syncAyaxPlans,
  togglePlanStatus,
  deletePlan,
};