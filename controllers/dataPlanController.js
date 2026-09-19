const mongoose = require("mongoose");
const DataPlan = require("../models/DataPlan");
const axios = require("axios");

// 1. Ayax API Gateway Base Configuration
const RAW_URL =
  process.env.AYAX_API_BASE_URL ||
  process.env.MARKETPLACE_API_URL ||
  "https://ayax-api-marketplace.onrender.com";

const CLEAN_BASE = RAW_URL.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
const AYAX_API_BASE_URL = `${CLEAN_BASE}/api/v1`;

const AYAX_API_KEY = process.env.AYAX_API_KEY || process.env.MARKETPLACE_API_KEY;
const getHeaders = () => ({
  "Content-Type": "application/json",
  "x-api-key": AYAX_API_KEY,
  Authorization: `Bearer ${AYAX_API_KEY}`,
});

/**
 * Normalizer Helper: Tabbatar da cewa kowane plan yana dauke da filayen
 * da Admin Dashboard da Mobile App suke bukata.
 */
const normalizePlan = (p) => {
  const pId = String(p.planId || p.planCode || p.id || p.code || p._id || "").trim();
  const net = String(p.network || p.networkName || "MTN").toUpperCase().trim();
  const pName = p.name || p.plan || p.planLabel || `${p.sizeGB || ""}GB Plan`;
  const uPrice = Number(p.userPrice ?? p.price ?? 0);
  const aPrice = Number(p.agentPrice ?? uPrice);
  const v = p.validity || "30 Days";
  const t = String(p.planType || p.type || "DC").toUpperCase();

  return {
    ...p,
    _id: p._id || pId,
    id: pId,
    planId: pId,
    planCode: pId,
    code: pId,
    network: net,
    networkName: net,
    name: pName,
    plan: pName,
    planLabel: pName,
    userPrice: uPrice,
    price: uPrice,
    agentPrice: aPrice,
    costPrice: Number(p.costPrice || 0),
    validity: v,
    planType: t,
    type: t,
    status: p.status || (p.isActive === false ? "disabled" : "active"),
    isActive: p.isActive !== false && p.status !== "disabled"
  };
};

/**
 * 1. GET ALL ACTIVE PLANS (Public / App Frontend)
 */
const getPlans = async (req, res) => {
  try {
    const { network, networkName, planType, type } = req.query;
    const targetNetwork = network || networkName;
    const targetType = planType || type;

    let plans = [];
    const db = mongoose.connection.db;

    // A duba kai-tsaye a duka collections guda biyu (plans da dataplans)
    if (db) {
      try {
        const rawPlans = await db.collection("plans").find({}).sort({ network: 1, userPrice: 1 }).toArray();
        if (rawPlans && rawPlans.length > 0) plans = rawPlans;
        else {
          const rawDataPlans = await db.collection("dataplans").find({}).sort({ network: 1, userPrice: 1 }).toArray();
          if (rawDataPlans && rawDataPlans.length > 0) plans = rawDataPlans;
        }
      } catch (_) {}
    }

    if ((!plans || plans.length === 0) && DataPlan) {
      plans = await DataPlan.find().sort({ networkName: 1, userPrice: 1 }).lean();
    }

    let normalized = (plans || []).map(normalizePlan);

    // Tace su bisa Network idan an nema
    if (targetNetwork && targetNetwork !== "all") {
      const netQuery = String(targetNetwork).toUpperCase().trim();
      normalized = normalized.filter(p => p.network === netQuery);
    }

    // Tace su bisa Plan Type idan an nema
    if (targetType && targetType !== "all") {
      const typeQuery = String(targetType).toUpperCase().trim();
      normalized = normalized.filter(p => p.planType === typeQuery);
    }

    return res.status(200).json({
      success: true,
      status: "success",
      count: normalized.length,
      data: normalized,
      plans: normalized,
    });
  } catch (error) {
    console.error("Get Plans Error:", error);
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
    let plans = [];
    const db = mongoose.connection.db;

    if (db) {
      try {
        const rawPlans = await db.collection("plans").find({}).sort({ network: 1, userPrice: 1 }).toArray();
        if (rawPlans && rawPlans.length > 0) plans = rawPlans;
        else {
          const rawDataPlans = await db.collection("dataplans").find({}).sort({ network: 1, userPrice: 1 }).toArray();
          if (rawDataPlans && rawDataPlans.length > 0) plans = rawDataPlans;
        }
      } catch (_) {}
    }

    if ((!plans || plans.length === 0) && DataPlan) {
      plans = await DataPlan.find().sort({ networkName: 1, userPrice: 1 }).lean();
    }

    const normalized = (plans || []).map(normalizePlan);

    return res.status(200).json({
      success: true,
      status: "success",
      count: normalized.length,
      data: normalized,
      plans: normalized,
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
 * 3. SET OR UPDATE PLAN PRICING & METRICS (Saves to BOTH `plans` and `dataplans`)
 */
const setPlanPrice = async (req, res) => {
  const {
    id,
    networkId,
    planCode,
    planId,
    code,
    userPrice,
    price,
    agentPrice,
    costPrice,
    planLabel,
    name,
    plan,
    networkName,
    network,
    sizeGB,
    planType,
    type,
    validity,
    status,
    isActive,
  } = req.body;

  try {
    const finalNetName = String(networkName || network || networkId || "MTN").toUpperCase().trim();
    const finalPlanCode = String(planCode || planId || code || id || "").trim();
    const finalLabel = name || plan || planLabel || `${sizeGB || ""}GB Plan`;
    const finalUPrice = Number(userPrice !== undefined ? userPrice : price || 0);
    const finalAPrice = Number(agentPrice !== undefined ? agentPrice : finalUPrice);
    const finalStatus = status || (isActive === false ? "disabled" : "active");
    const activeBool = finalStatus !== "disabled" && isActive !== false;

    if (!finalPlanCode || finalUPrice <= 0) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "planCode/planId and userPrice are required.",
      });
    }

    const planData = {
      id: finalPlanCode,
      planId: finalPlanCode,
      planCode: finalPlanCode,
      code: finalPlanCode,
      network: finalNetName,
      networkName: finalNetName,
      networkId: finalNetName,
      name: finalLabel,
      plan: finalLabel,
      planLabel: finalLabel,
      userPrice: finalUPrice,
      price: finalUPrice,
      agentPrice: finalAPrice,
      costPrice: Number(costPrice || 0),
      sizeGB: sizeGB ? Number(sizeGB) : (parseFloat(finalLabel) || 1),
      planType: String(planType || type || "DC").toUpperCase(),
      type: String(planType || type || "DC").toUpperCase(),
      validity: validity || "30 Days",
      status: finalStatus,
      isActive: activeBool,
      updatedAt: new Date()
    };

    const db = mongoose.connection.db;
    if (db) {
      const matchCriteria = {
        $or: [
          { id: finalPlanCode },
          { planId: finalPlanCode },
          { planCode: finalPlanCode }
        ]
      };
      await db.collection("plans").updateOne(matchCriteria, { $set: planData,$setOnInsert: { createdAt: new Date() } }, { upsert: true });
      await db.collection("dataplans").updateOne(matchCriteria, { $set: planData,$setOnInsert: { createdAt: new Date() } }, { upsert: true });
    }

    if (DataPlan) {
      await DataPlan.findOneAndUpdate(
        { $or: [{ planCode: finalPlanCode }, { planId: finalPlanCode }] },
        { $set: planData },
        { upsert: true, new: true }
      ).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      status: "success",
      message: "Data plan pricing updated across all collections successfully.",
      data: planData,
      plan: planData,
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
 * 4. SYNC PLANS FROM AYAX VTU API GATEWAY
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

    const db = mongoose.connection.db;
    let syncedCount = 0;

    for (const p of plansList) {
      const pCode = String(p.planCode || p.plan_code || p.planId || p.id || p.code || "");
      const netName = String(p.networkName || p.network_name || p.network || "MTN").toUpperCase();
      const pLabel = p.planLabel || p.name || p.title || p.description || `${p.sizeGB || ""}GB Plan`;
      const apiPrice = Number(p.costPrice || p.price || p.amount || p.apiPrice || 0);
      const sizeGB = Number(p.sizeGB || p.size || p.volume || 0);
      const planType = String(p.planType || p.type || "SME").toUpperCase();
      const validity = p.validity || "30 Days";

      if (pCode) {
        const doc = {
          id: pCode,
          planId: pCode,
          planCode: pCode,
          network: netName,
          networkName: netName,
          planLabel: pLabel,
          name: pLabel,
          plan: pLabel,
          userPrice: apiPrice > 0 ? apiPrice + 50 : 250,
          price: apiPrice > 0 ? apiPrice + 50 : 250,
          agentPrice: apiPrice > 0 ? apiPrice + 20 : 230,
          costPrice: apiPrice,
          sizeGB,
          planType,
          type: planType,
          validity,
          status: "active",
          isActive: true,
          updatedAt: new Date(),
        };

        if (db) {
          await db.collection("plans").updateOne({ $or: [{ id: pCode }, { planId: pCode }] }, {$set: doc }, { upsert: true });
          await db.collection("dataplans").updateOne({ $or: [{ id: pCode }, { planId: pCode }] }, {$set: doc }, { upsert: true });
        }
        syncedCount++;
      }
    }

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Successfully synchronized ${syncedCount} plans.`,
      syncedCount,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to sync plans: " + error.message,
    });
  }
};

/**
 * 5. TOGGLE PLAN ACTIVE STATUS
 */
const togglePlanStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const db = mongoose.connection.db;
    let newActiveState = true;

    if (db) {
      const match = { $or: [{ _id: mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : null }, { id }, { planId: id }] };
      const current = await db.collection("plans").findOne(match) || await db.collection("dataplans").findOne(match);
      if (current) {
        newActiveState = current.isActive === false || current.status === "disabled";
        const newStatus = newActiveState ? "active" : "disabled";
        await db.collection("plans").updateMany(match, { $set: { isActive: newActiveState, status: newStatus } });
        await db.collection("dataplans").updateMany(match, { $set: { isActive: newActiveState, status: newStatus } });
      }
    }

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Plan marked as ${newActiveState ? "Active" : "Disabled"}.`,
      isActive: newActiveState
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 6. DELETE PLAN
 */
const deletePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const db = mongoose.connection.db;

    if (db) {
      const match = { $or: [{ _id: mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : null }, { id }, { planId: id }, { planCode: id }] };
      await db.collection("plans").deleteMany(match);
      await db.collection("dataplans").deleteMany(match);
    }

    if (DataPlan) {
      await DataPlan.findByIdAndDelete(id).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      status: "success",
      message: "Data plan deleted successfully from all collections.",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
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