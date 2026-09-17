const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// Shigo da ingantaccen middleware da controllers
let authMiddleware = {};
try {
  authMiddleware = require("../middleware/authMiddleware");
} catch (e) {
  try {
    authMiddleware = require("../middleware/auth");
  } catch (err) {}
}

const protect =
  authMiddleware.protect ||
  authMiddleware.verifyToken ||
  ((req, res, next) => next());

let vtuController = {};
try {
  vtuController = require("../controllers/vtuController");
} catch (e) {}

let dataPlanController = {};
try {
  dataPlanController = require("../controllers/dataPlanController");
} catch (e) {
  try {
    dataPlanController = require("../controllers/data.controller");
  } catch (err) {}
}

// Helper don kiyaye undefined errors a vtuController
const safeData = (handlerName) => {
  return (req, res, next) => {
    if (typeof vtuController[handlerName] === "function") {
      return vtuController[handlerName](req, res, next);
    }
    return res.status(501).json({
      success: false,
      message: `Data handler '${handlerName}' not implemented in vtuController`,
    });
  };
};

// Helper don kiran dataPlanController
const handleGetPlans = (req, res, next) => {
  if (typeof dataPlanController?.getPlans === "function") {
    return dataPlanController.getPlans(req, res, next);
  }
  if (typeof dataPlanController?.getAllDataPlans === "function") {
    return dataPlanController.getAllDataPlans(req, res, next);
  }
  if (typeof dataPlanController?.getActivePlans === "function") {
    return dataPlanController.getActivePlans(req, res, next);
  }

  // Fallback direct mongoose query idan controller bai amsa ba
  try {
    const DataPlan = mongoose.models.DataPlan || mongoose.model("DataPlan");
    DataPlan.find({ isActive: true })
      .then((plans) => res.status(200).json({ success: true, data: plans }))
      .catch((err) => res.status(500).json({ success: false, message: err.message }));
  } catch (e) {
    return res.status(404).json({
      success: false,
      message: "Plans handler not found in dataPlanController",
    });
  }
};

// Universal Delete Plan Handler (Wanda yake magance 404 din nan)
const handleDeletePlan = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: "Plan ID is required." });
    }

    if (typeof dataPlanController?.deletePlan === "function") {
      return dataPlanController.deletePlan(req, res);
    }

    // Dynamic Model Lookup idan babu a controller
    let DataPlan;
    try {
      DataPlan = mongoose.model("DataPlan");
    } catch (e) {
      try {
        DataPlan = require("../models/DataPlan");
      } catch (err) {
        DataPlan = mongoose.model("Plan");
      }
    }

    let deleted = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      deleted = await DataPlan.findByIdAndDelete(id);
    }

    if (!deleted) {
      deleted = await DataPlan.findOneAndDelete({
        $or: [{ _id: id }, { id: id }, { planId: id }, { planCode: id }, { code: id }],
      });
    }

    return res.status(200).json({
      success: true,
      message: "Plan deleted successfully.",
      deletedId: id,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete plan.",
      error: err.message,
    });
  }
};

/* ======================================================
   1. PUBLIC / USER DATA PLANS (Duba Tsare-tsaren Data)
====================================================== */
router.get("/plans", handleGetPlans);
router.get("/all-plans", handleGetPlans);
router.get("/active", handleGetPlans);
router.get("/", handleGetPlans);

// Admin Synchronization
if (typeof dataPlanController?.syncAyaxPlans === "function") {
  router.post("/sync-plans", dataPlanController.syncAyaxPlans);
}

/* ======================================================
   2. DATA PLAN MANAGEMENT (DELETE & UPDATE) - WANNAN NE AKA ƘARA
====================================================== */
router.delete("/plans/:id", handleDeletePlan);
router.delete("/data/plans/:id", handleDeletePlan);

/* ======================================================
   3. AUTHENTICATED DATA PURCHASE (Sayen Data)
====================================================== */
router.use(protect);

router.post("/buy", safeData("buyData"));
router.post("/buy-data", safeData("buyData"));
router.post("/buy-data-custom", safeData("buyData"));
router.post("/", safeData("buyData"));

module.exports = router;