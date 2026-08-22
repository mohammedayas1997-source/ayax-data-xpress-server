const express = require("express");
const router = express.Router();

// Shigo da ingantaccen middleware da controllers
const { protect } = require("../middleware/authMiddleware");
const vtuController = require("../controllers/vtuController");
const dataPlanController = require("../controllers/dataPlanController");

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

// Helper don kiran dataPlanController (getActivePlans ko getPlans)
const handleGetPlans = (req, res, next) => {
  if (typeof dataPlanController?.getActivePlans === "function") {
    return dataPlanController.getActivePlans(req, res, next);
  }
  if (typeof dataPlanController?.getPlans === "function") {
    return dataPlanController.getPlans(req, res, next);
  }
  return res.status(404).json({
    success: false,
    message: "Plans handler not found in dataPlanController",
  });
};

/* ======================================================
   1. PUBLIC / USER DATA PLANS (Duba Tsare-tsaren Data)
====================================================== */
router.get("/plans", handleGetPlans);
router.get("/active", handleGetPlans);
router.get("/", handleGetPlans);

/* ======================================================
   2. AUTHENTICATED DATA PURCHASE (Sayen Data)
====================================================== */
router.use(protect);

router.post("/buy", safeData("buyData"));
router.post("/buy-data", safeData("buyData"));
router.post("/buy-data-custom", safeData("buyData"));
router.post("/", safeData("buyData"));

module.exports = router;