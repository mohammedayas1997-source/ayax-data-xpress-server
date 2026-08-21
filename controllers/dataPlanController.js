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