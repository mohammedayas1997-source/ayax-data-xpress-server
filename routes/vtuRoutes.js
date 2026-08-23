const express = require("express");
const router = express.Router();

// 1. Dauko Controllers daban-daban don tabbatar da cewa babu safe() fallback da ke makalewa
const dataController = require("../controllers/data.controller");
const airtimeController = require("../controllers/airtime.controller");
const vtuController = require("../controllers/vtuController");
const { protect } = require("../middleware/authMiddleware");

// Helper don kiyaye kuskuren undefined callback
const safe = (controller, handlerName) => {
  return (req, res, next) => {
    if (controller && typeof controller[handlerName] === "function") {
      return controller[handlerName](req, res, next);
    }
    return res.status(501).json({
      success: false,
      message: `Endpoint handler '${handlerName}' is not implemented`,
    });
  };
};

// Duk hanyoyin suna bukatar login
router.use(protect);

/* ======================================================
   1. DATA SERVICES (Hada kai tsaye da dataController)
====================================================== */
const dataHandler = (req, res, next) => {
  if (dataController && typeof dataController.buyData === "function") {
    return dataController.buyData(req, res, next);
  }
  if (vtuController && typeof vtuController.buyData === "function") {
    return vtuController.buyData(req, res, next);
  }
  return res.status(501).json({ success: false, message: "buyData handler not found" });
};

router.post("/buy-data", dataHandler);
router.post("/buy-data-custom", dataHandler);
router.post("/data", dataHandler);
router.post("/data/buy", dataHandler);
router.post("/buy", dataHandler);

/* ======================================================
   2. AIRTIME SERVICES (Hada kai tsaye da airtimeController)
====================================================== */
const airtimeHandler = (req, res, next) => {
  if (airtimeController && typeof airtimeController.buyAirtime === "function") {
    return airtimeController.buyAirtime(req, res, next);
  }
  if (vtuController && typeof vtuController.buyAirtime === "function") {
    return vtuController.buyAirtime(req, res, next);
  }
  return res.status(501).json({ success: false, message: "buyAirtime handler not found" });
};

router.post("/buy-airtime", airtimeHandler);
router.post("/airtime", airtimeHandler);
router.post("/airtime/buy", airtimeHandler);

/* ======================================================
   3. UTILITY BILLS (ELECTRICITY & CABLE)
====================================================== */
router.post("/electricity", safe(vtuController, "purchaseElectricity"));
router.post("/buy-electricity", safe(vtuController, "purchaseElectricity"));
router.post("/cable", safe(vtuController, "purchaseCable"));
router.post("/buy-cable", safe(vtuController, "purchaseCable"));

/* ======================================================
   4. VERIFICATION & VALIDATION
====================================================== */
router.post("/verify-meter", safe(vtuController, "verifyMeter"));
router.post("/verify-smartcard", safe(vtuController, "verifySmartCard"));
router.post("/nimc-validate", safe(vtuController, "nimcValidation"));

/* ======================================================
   5. TRANSACTION STATUS & HISTORY
====================================================== */
router.get("/transactions", safe(vtuController, "getTransactionHistory"));
router.get("/status/:reference", safe(vtuController, "getTransactionStatus"));
router.get("/transaction-status/:reference", safe(vtuController, "getTransactionStatus"));

module.exports = router;