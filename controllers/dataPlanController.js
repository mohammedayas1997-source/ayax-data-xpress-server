const DataPlan = require("../models/DataPlan");
const axios = require("axios");

// 1. Tsabtace URL don kauce wa matsalar duplicate /api/v1
const RAW_URL =
  process.env.AYAX_API_BASE_URL ||
  process.env.MARKETPLACE_API_URL ||
  "https://ayax-api-marketplace.onrender.com";

const CLEAN_BASE = RAW_URL.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
const AYAX_API_BASE_URL = `${CLEAN_BASE}/api/v1`;

const AYAX_API_KEY =
  process.env.AYAX_API_KEY ||
  process.env.MARKETPLACE_API_KEY ||
  "ayax_live_13e936ef28c32f2b9d99f2974949e411608490dc069de75ad06f165251eb5345";

/**
 * @desc    Get All Active Data Plans for Home & BuyData Screens
 * @route   GET /api/v1/data/plans OR GET /api/v1/plans
 * @access  Public / Authenticated
 */
exports.getPlans = async (req, res) => {
  try {
    const { network, planType } = req.query;
    let filter = { isActive: { $ne: false } };

    if (network && network !== "ALL") {
      const netRegex = new RegExp(`^${network.trim()}$`, "i");
      filter.$or = [
        { network: netRegex },
        { networkName: netRegex },
        { networkId: netRegex }
      ];
    }

    if (planType && planType !== "ALL") {
      filter.planType = new RegExp(`^${planType.trim()}$`, "i");
    }

    const rawPlans = await DataPlan.find(filter)
      .sort({ network: 1, userPrice: 1, price: 1 })
      .lean();

    // Daidaita sunayen filaye (Normalization) domin kowane Screen ya gane su
    const formattedPlans = rawPlans.map((p) => {
      const net = (p.network || p.networkName || p.networkId || "MTN").toUpperCase();
      const name = p.name || p.planLabel || `${net} ${p.planCode || ""}`;
      const uPrice = Number(p.userPrice ?? p.price ?? 0);
      const aPrice = Number(p.agentPrice ?? p.userPrice ?? p.price ?? 0);
      const code = p.planCode || p.code || "1000";
      const validity = p.validity ? (String(p.validity).includes("Day") ? p.validity : `${p.validity} Days`) : "30 Days";

      return {
        ...p,
        _id: p._id,
        id: p._id,
        network: net,
        networkName: net,
        name: name,
        planLabel: name,
        planCode: code,
        code: code,
        userPrice: uPrice,
        price: uPrice,
        agentPrice: aPrice,
        planType: p.planType || "SME",
        validity: validity,
        isActive: p.isActive !== false,
      };
    });

    return res.status(200).json({
      success: true,
      status: "success",
      count: formattedPlans.length,
      data: formattedPlans,
      plans: formattedPlans,
    });
  } catch (error) {
    console.error("Get Plans Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch data plans from database",
      error: error.message,
    });
  }
};

// Aliases domin kowace hanya ta gane
exports.getDataPlans = exports.getPlans;
exports.getAllDataPlans = exports.getPlans;

/**
 * @desc    Sync / Fetch Plans from Ayax APIs (Admin Only)
 * @route   POST /api/v1/admin/sync-plans
 */
exports.syncAyaxPlans = async (req, res) => {
  try {
    let response;
    const requestHeaders = {
      "x-api-key": AYAX_API_KEY,
      Authorization: `Bearer ${AYAX_API_KEY}`,
      "Content-Type": "application/json",
    };

    // Gwada hanyar /data/plans, idan ta ba da 404 sai a gwada /plans
    try {
      response = await axios.get(`${AYAX_API_BASE_URL}/data/plans`, {
        headers: requestHeaders,
        timeout: 30000,
      });
    } catch (err) {
      if (err.response?.status === 404) {
        response = await axios.get(`${AYAX_API_BASE_URL}/plans`, {
          headers: requestHeaders,
          timeout: 30000,
        });
      } else {
        throw err;
      }
    }

    const resData = response.data;
    const plansList =
      resData?.data || resData?.plans || (Array.isArray(resData) ? resData : []);

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
      const pLabel = p.planLabel || p.name || p.title || p.description || `${netId} ${pCode}`;
      const netName = String(p.networkName || p.network_name || p.network || netId).toUpperCase();
      const apiPrice = Number(p.price || p.amount || p.apiPrice || 0);

      if (netId && pCode) {
        await DataPlan.findOneAndUpdate(
          { $or: [{ planCode: pCode }, { networkId: netId, planCode: pCode }] },
          {
            network: netName,
            networkName: netName,
            networkId: netId,
            planCode: pCode,
            name: pLabel,
            planLabel: pLabel,
            userPrice: apiPrice > 0 ? apiPrice + 50 : 300,
            agentPrice: apiPrice > 0 ? apiPrice + 20 : 280,
            costPrice: apiPrice,
            sizeGB: Number(p.sizeGB || p.size || 0),
            planType: p.planType || p.type || "SME",
            validity: p.validity || "30 Days",
            isActive: true,
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