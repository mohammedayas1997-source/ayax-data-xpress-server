const express = require("express");
const router = express.Router();

// Shigo da ingantaccen middleware da controller
const { protect } = require("../middleware/authMiddleware");
const vtuController = require("../controllers/vtuController");
const dataPlanController = require("../controllers/dataPlanController");

// Helper don kiyaye undefined errors
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

/* ======================================================
   PUBLIC / USER DATA PLANS
====================================================== */
router.get("/plans", (req, res, next) => {
  if (typeof dataPlanController?.getPlans === "function") {
    return dataPlanController.getPlans(req, res, next);
  }
  return res.status(404).json({ success: false, message: "Plans handler not found" });
});

/* ======================================================
   AUTHENTICATED DATA PURCHASE
====================================================== */
router.use(protect);

router.post("/buy", safeData("buyData"));
router.post("/", safeData("buyData"));

module.exports = router;