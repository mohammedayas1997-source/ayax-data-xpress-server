const express = require("express");
const router = express.Router();
const vtuController = require("../controllers/vtuController");
const { protect } = require("../middleware/authMiddleware");

// Helper don kiyaye kuskuren undefined callback
const safe = (handlerName) => {
  return (req, res, next) => {
    if (typeof vtuController[handlerName] === "function") {
      return vtuController[handlerName](req, res, next);
    }
    return res.status(501).json({
      success: false,
      message: `Endpoint handler '${handlerName}' is not implemented in vtuController`,
    });
  };
};

// Duk hanyoyin suna buƙatar login
router.use(protect);

/* ======================================================
   1. DATA SERVICES
====================================================== */
router.post("/buy-data", safe("buyData"));
router.post("/data", safe("buyData"));
router.post("/data/buy", safe("buyData"));
router.post("/buy", safe("buyData"));

/* ======================================================
   2. AIRTIME SERVICES
====================================================== */
router.post("/buy-airtime", safe("buyAirtime"));
router.post("/airtime", safe("buyAirtime"));
router.post("/airtime/buy", safe("buyAirtime"));

/* ======================================================
   3. UTILITY BILLS (ELECTRICITY & CABLE)
====================================================== */
router.post("/electricity", safe("purchaseElectricity"));
router.post("/buy-electricity", safe("purchaseElectricity"));
router.post("/cable", safe("purchaseCable"));
router.post("/buy-cable", safe("purchaseCable"));

/* ======================================================
   4. VERIFICATION & VALIDATION
====================================================== */
router.post("/verify-meter", safe("verifyMeter"));
router.post("/verify-smartcard", safe("verifySmartCard"));
router.post("/nimc-validate", safe("nimcValidation"));

/* ======================================================
   5. TRANSACTION STATUS & HISTORY
====================================================== */
router.get("/transactions", safe("getTransactionHistory"));
router.get("/status/:reference", safe("getTransactionStatus"));
router.get("/transaction-status/:reference", safe("getTransactionStatus"));

module.exports = router;