const mongoose = require("mongoose");
let DataPlan = null;
try {
  DataPlan = require("../models/DataPlan");
} catch (_) {
  try {
    DataPlan = require("../models/dataPlan.model") || require("../models/plan.model");
  } catch (__) {}
}
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
 * da Admin Dashboard, Mobile App, da Web Frontend suke bukata.
 */
const normalizePlan = (p) => {
  const pId = String(p.planId || p.planCode || p.id || p.code || p._id || "").trim();
  const net = String(p.network || p.networkName || "MTN").toUpperCase().trim();
  const pName = p.name || p.plan || p.planLabel || `${p.sizeGB || ""}GB Plan`;
  const uPrice = Number(p.userPrice ?? p.price ?? p.customerPrice ?? 0);
  const aPrice = Number(p.agentPrice ?? p.wholesalePrice ?? uPrice);
  const v = p.validity || p.duration || "30 Days";
  const t = String(p.planType || p.type || p.category || "DC").toUpperCase();

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
    duration: v,
    planType: t,
    type: t,
    status: p.status || (p.isActive === false ? "disabled" : "active"),
    isActive: p.isActive !== false && p.status !== "disabled",
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
    const db = mongoose.connection?.db;

    if (db) {
      try {
        const rawPlans = await db
          .collection("plans")
          .find({})
          .sort({ network: 1, userPrice: 1 })
          .toArray();
        if (rawPlans && rawPlans.length > 0) plans = rawPlans;
        else {
          const rawDataPlans = await db
            .collection("dataplans")
            .find({})
            .sort({ network: 1, userPrice: 1 })
            .toArray();
          if (rawDataPlans && rawDataPlans.length > 0) plans = rawDataPlans;
        }
      } catch (_) {}
    }

    if ((!plans || plans.length === 0) && DataPlan && typeof DataPlan.find === "function") {
      try {
        plans = await DataPlan.find().sort({ networkName: 1, userPrice: 1 }).lean();
      } catch (_) {}
    }

    let normalized = (plans || []).map(normalizePlan);

    // Tace su bisa Network
    if (targetNetwork && targetNetwork !== "all") {
      const netQuery = String(targetNetwork).toUpperCase().trim();
      normalized = normalized.filter((p) => p.network === netQuery);
    }

    // Tace su bisa Plan Type
    if (targetType && targetType !== "all") {
      const typeQuery = String(targetType).toUpperCase().trim();
      normalized = normalized.filter((p) => p.planType === typeQuery || p.type === typeQuery);
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
    const db = mongoose.connection?.db;

    if (db) {
      try {
        const rawPlans = await db
          .collection("plans")
          .find({})
          .sort({ network: 1, userPrice: 1 })
          .toArray();
        if (rawPlans && rawPlans.length > 0) plans = rawPlans;
        else {
          const rawDataPlans = await db
            .collection("dataplans")
            .find({})
            .sort({ network: 1, userPrice: 1 })
            .toArray();
          if (rawDataPlans && rawDataPlans.length > 0) plans = rawDataPlans;
        }
      } catch (_) {}
    }

    if ((!plans || plans.length === 0) && DataPlan && typeof DataPlan.find === "function") {
      try {
        plans = await DataPlan.find().sort({ networkName: 1, userPrice: 1 }).lean();
      } catch (_) {}
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
 * Helper: Shirya bayanai don adanawa a Database
 */
const buildPlanObject = (body) => {
  const finalNetName = String(
    body.networkName || body.network || body.network_id || "MTN"
  )
    .toUpperCase()
    .trim();

  // Ɗauko ainihin lambar plan code (kamar mtn-tr-1gb-7days ko mtn-sme-1gb)
  const rawCode = String(
    body.planCode ||
      body.gatewayPlanId ||
      body.gatewayId ||
      body.planId ||
      body.code ||
      body.serviceCode ||
      body.id ||
      ""
  )
    .toLowerCase()
    .trim();

  const finalPlanCode = rawCode || `plan_${Date.now()}`;
  const finalSize = body.sizeGB || body.volume || body.planVolume || body.size || "1GB";
  const finalLabel =
    body.name ||
    body.plan ||
    body.planLabel ||
    `${finalNetName} ${finalSize} (${body.validityDuration || body.validity || "30 Days"})`;

  const finalUPrice = Number(
    body.userPrice !== undefined
      ? body.userPrice
      : body.customerSellingPrice !== undefined
      ? body.customerSellingPrice
      : body.price || 0
  );

  const finalAPrice = Number(
    body.agentPrice !== undefined
      ? body.agentPrice
      : body.retailAgentPrice !== undefined
      ? body.retailAgentPrice
      : finalUPrice
  );

  const finalCost = Number(body.costPrice || body.wholesalePrice || 0);
  const finalStatus = body.status || (body.isActive === false ? "disabled" : "active");
  const activeBool = finalStatus !== "disabled" && body.isActive !== false;

  return {
    id: finalPlanCode,
    planId: finalPlanCode,
    planCode: finalPlanCode,
    code: finalPlanCode,
    serviceCode: finalPlanCode,
    network: finalNetName,
    networkName: finalNetName,
    networkId: finalNetName,
    name: finalLabel,
    plan: finalLabel,
    planLabel: finalLabel,
    userPrice: finalUPrice,
    customerSellingPrice: finalUPrice,
    price: finalUPrice,
    agentPrice: finalAPrice,
    retailAgentPrice: finalAPrice,
    costPrice: finalCost,
    sizeGB: typeof finalSize === "number" ? finalSize : parseFloat(finalSize) || 1,
    size: String(finalSize),
    volume: String(finalSize),
    planType: String(
      body.planType || body.type || body.category || body.planCategory || "SME"
    ).toUpperCase(),
    type: String(
      body.planType || body.type || body.category || body.planCategory || "SME"
    ).toUpperCase(),
    category: String(
      body.category || body.planCategory || body.planType || "SME"
    ).toUpperCase(),
    validity: body.validity || body.validityDuration || body.duration || "30 Days",
    validityDuration: body.validityDuration || body.validity || "30 Days",
    duration: body.validityDuration || body.validity || "30 Days",
    status: finalStatus,
    isActive: activeBool,
    updatedAt: new Date(),
  };
};

/**
 * 3. PUBLISH TARIFF / CREATE PLAN (Yana gyara kuskuren DataPlanModel.create is not a function)
 */
const createPlan = async (req, res) => {
  try {
    const planData = buildPlanObject(req.body);

    if (!planData.planCode || planData.userPrice <= 0) {
      return res.status(400).json({
        success: false,
        status: "failed",
        message: "Gateway Plan ID (Variation Code) and Selling Price are required.",
      });
    }

    const db = mongoose.connection?.db;
    if (db) {
      const matchCriteria = {
        $or: [
          { id: planData.planCode },
          { planId: planData.planCode },
          { planCode: planData.planCode },
          { code: planData.planCode },
        ],
      };
      await db
        .collection("plans")
        .updateOne(
          matchCriteria,
          { $set: planData, $setOnInsert: { createdAt: new Date() } },
          { upsert: true }
        );
      await db
        .collection("dataplans")
        .updateOne(
          matchCriteria,
          { $set: planData, $setOnInsert: { createdAt: new Date() } },
          { upsert: true }
        );
    }

    if (DataPlan) {
      try {
        if (typeof DataPlan.findOneAndUpdate === "function") {
          await DataPlan.findOneAndUpdate(
            { $or: [{ planCode: planData.planCode }, { planId: planData.planCode }] },
            { $set: planData },
            { upsert: true, new: true }
          );
        } else if (typeof DataPlan.create === "function") {
          await DataPlan.create(planData);
        }
      } catch (_) {}
    }

    return res.status(200).json({
      success: true,
      status: "success",
      message: "Tariff successfully published to database and mobile app!",
      data: planData,
      plan: planData,
    });
  } catch (error) {
    console.error("Publish Tariff Error:", error);
    return res.status(500).json({
      success: false,
      status: "failed",
      message: "Error publishing tariff: " + error.message,
    });
  }
};

/**
 * 4. SET OR UPDATE PLAN PRICING
 */
const setPlanPrice = async (req, res) => {
  return createPlan(req, res);
};

/**
 * 5. SYNC PLANS FROM AYAX VTU API GATEWAY & AUTOSYNC V2
 */
const syncAyaxPlans = async (req, res) => {
  try {
    let syncedCount = 0;
    const db = mongoose.connection?.db;

    // Hanyoyin karbar dukkan nau'o'in data (Gifting, SME, Transfer, Corporate)
    const endpointsToTry = [
      `${AYAX_API_BASE_URL}/v2/data`,
      `${AYAX_API_BASE_URL}/v2/data/sme`,
      `${AYAX_API_BASE_URL}/v2/data/transfer`,
      `${AYAX_API_BASE_URL}/v2/data/corporate`,
      `${AYAX_API_BASE_URL}/data/plans`,
      `${AYAX_API_BASE_URL}/plans`,
    ];

    for (const url of endpointsToTry) {
      try {
        const response = await axios.get(url, {
          headers: getHeaders(),
          timeout: 15000,
        });

        const resData = response?.data;
        let list = [];

        // Karanta tsarin v2 mai dauke da category.products[].groups[].variations[]
        if (resData?.data?.category?.products) {
          for (const prod of resData.data.category.products) {
            const netName = String(prod.name || prod.code || "MTN").toUpperCase();
            if (prod.groups) {
              for (const grp of prod.groups) {
                if (grp.variations) {
                  for (const v of grp.variations) {
                    list.push({
                      code: v.code,
                      name: v.name,
                      amount: v.amount,
                      network: netName,
                      validity: grp.name || "30 Days",
                      planType: resData.data.category.type || "DATA",
                    });
                  }
                }
              }
            }
          }
        } else {
          list =
            resData?.data ||
            resData?.plans ||
            resData?.dataPlans ||
            (Array.isArray(resData) ? resData : []);
        }

        if (Array.isArray(list) && list.length > 0) {
          for (const p of list) {
            const pCode = String(
              p.code || p.planCode || p.plan_code || p.planId || p.id || ""
            ).toLowerCase();
            if (!pCode) continue;

            const netName = String(
              p.network || p.networkName || "MTN"
            ).toUpperCase();
            const pLabel = p.name || p.planLabel || `${pCode.toUpperCase()}`;
            const apiPrice = Number(p.amount || p.costPrice || p.price || 0);

            const doc = {
              id: pCode,
              planId: pCode,
              planCode: pCode,
              code: pCode,
              serviceCode: pCode,
              network: netName,
              networkName: netName,
              planLabel: pLabel,
              name: pLabel,
              plan: pLabel,
              userPrice: apiPrice > 0 ? apiPrice + 50 : 300,
              customerSellingPrice: apiPrice > 0 ? apiPrice + 50 : 300,
              price: apiPrice > 0 ? apiPrice + 50 : 300,
              agentPrice: apiPrice > 0 ? apiPrice + 20 : 270,
              retailAgentPrice: apiPrice > 0 ? apiPrice + 20 : 270,
              costPrice: apiPrice,
              planType: String(p.planType || "DATA").toUpperCase(),
              type: String(p.planType || "DATA").toUpperCase(),
              validity: p.validity || "30 Days",
              status: "active",
              isActive: true,
              updatedAt: new Date(),
            };

            if (db) {
              await db
                .collection("plans")
                .updateOne(
                  { $or: [{ id: pCode }, { planId: pCode }, { code: pCode }] },
                  { $set: doc, $setOnInsert: { createdAt: new Date() } },
                  { upsert: true }
                );
              await db
                .collection("dataplans")
                .updateOne(
                  { $or: [{ id: pCode }, { planId: pCode }, { code: pCode }] },
                  { $set: doc, $setOnInsert: { createdAt: new Date() } },
                  { upsert: true }
                );
            }
            syncedCount++;
          }
        }
      } catch (_) {}
    }

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Successfully synchronized ${syncedCount} plans across all providers.`,
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
 * 6. TOGGLE PLAN ACTIVE STATUS
 */
const togglePlanStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const db = mongoose.connection?.db;
    let newActiveState = true;

    if (db) {
      const match = {
        $or: [
          { _id: mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : null },
          { id },
          { planId: id },
          { planCode: id },
          { code: id },
        ],
      };
      const current =
        (await db.collection("plans").findOne(match)) ||
        (await db.collection("dataplans").findOne(match));
      if (current) {
        newActiveState = current.isActive === false || current.status === "disabled";
        const newStatus = newActiveState ? "active" : "disabled";
        await db
          .collection("plans")
          .updateMany(match, { $set: { isActive: newActiveState, status: newStatus } });
        await db
          .collection("dataplans")
          .updateMany(match, { $set: { isActive: newActiveState, status: newStatus } });
      }
    }

    return res.status(200).json({
      success: true,
      status: "success",
      message: `Plan marked as ${newActiveState ? "Active" : "Disabled"}.`,
      isActive: newActiveState,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 7. DELETE PLAN
 */
const deletePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const db = mongoose.connection?.db;

    if (db) {
      const match = {
        $or: [
          { _id: mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : null },
          { id },
          { planId: id },
          { planCode: id },
          { code: id },
        ],
      };
      await db.collection("plans").deleteMany(match);
      await db.collection("dataplans").deleteMany(match);
    }

    if (DataPlan && typeof DataPlan.findByIdAndDelete === "function") {
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

// DataPlanModel Mock Object don kar wani controller ya kasa samun .create()
const DataPlanModelMock = {
  create: async (data) => {
    const planObj = buildPlanObject(data);
    const db = mongoose.connection?.db;
    if (db) {
      await db.collection("plans").updateOne(
        { id: planObj.planCode },
        { $set: planObj, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
      await db.collection("dataplans").updateOne(
        { id: planObj.planCode },
        { $set: planObj, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );
    }
    return planObj;
  },
};

module.exports = {
  getPlans,
  getDataPlans: getPlans,
  getAdminPlans,
  setPlanPrice,
  createPlan,
  publishTariff: createPlan,
  publishPlan: createPlan,
  addPlan: createPlan,
  createDataPlan: createPlan,
  syncAyaxPlans,
  togglePlanStatus,
  deletePlan,
  DataPlanModel: DataPlanModelMock,
};