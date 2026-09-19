const express = require("express");
const router = express.Router();
const vtuController = require("../controllers/vtuController");
const { protect } = require("../middleware/authMiddleware");
const { verifyTransactionPin } = require("../middleware/verifyPin");
const airtimeController = require("../controllers/airtimeController");
const dataController = require("../controllers/dataController");

// Import Utility & NIMC Controllers
let utilityController = {};
try {
  utilityController = require("../controllers/utilityController");
} catch (e) {
  try {
    utilityController = require("../controllers/billsController");
  } catch (err) {}
}

let nimcController = {};
try {
  nimcController = require("../controllers/nimcController");
} catch (e) {}

let validationController = {};
try {
  validationController = require("../controllers/validationController");
} catch (e) {}

// Helper don kiyaye kuskuren undefined callback
const safe = (handlerName) => {
  return (req, res, next) => {
    if (vtuController && typeof vtuController[handlerName] === "function") {
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
   1. DATA SERVICES (KADAI KAWAI DATA YA KIRA)
====================================================== */
const handleBuyData = (req, res, next) => {
  if (dataController && typeof dataController.buyData === "function") {
    return dataController.buyData(req, res, next);
  }
  return safe("buyData")(req, res, next);
};

router.post("/buy-data", handleBuyData);
router.post("/buy-data-custom", handleBuyData);
router.post("/data", handleBuyData);
router.post("/data/buy", handleBuyData);
router.post("/buy", handleBuyData);

/* ======================================================
   2. AIRTIME SERVICES (DIRECT TO AIRTIME CONTROLLER)
   Wannan zai tabbatar da cewa Al-Ihsan airtime.php ne kawai za a kira
====================================================== */
const handleBuyAirtime = (req, res, next) => {
  if (airtimeController && typeof airtimeController.buyAirtime === "function") {
    return airtimeController.buyAirtime(req, res, next);
  }
  return safe("buyAirtime")(req, res, next);
};

router.post("/buy-airtime", handleBuyAirtime);
router.post("/airtime", handleBuyAirtime);
router.post("/airtime/buy", handleBuyAirtime);

/* ======================================================
   3. CABLE TV
====================================================== */
const handleVerifySmartcard =
  utilityController.verifySmartCard || safe("verifySmartCard");
router.post("/validate-cable", handleVerifySmartcard);
router.post("/cable/verify", handleVerifySmartcard);
router.post("/verify-smartcard", handleVerifySmartcard);

const handleBuyCable =
  utilityController.buyCableSubscription || safe("purchaseCable");
router.post("/pay-cable", verifyTransactionPin, handleBuyCable);
router.post("/cable/buy", verifyTransactionPin, handleBuyCable);
router.post("/cable", verifyTransactionPin, handleBuyCable);
router.post("/buy-cable", verifyTransactionPin, handleBuyCable);

if (utilityController.getCablePlans) {
  router.get("/cable/plans", utilityController.getCablePlans);
}

/* ======================================================
   4. ELECTRICITY BILLS
====================================================== */
const handleVerifyMeter =
  utilityController.verifyMeter || safe("verifyMeter");
router.post("/validate-meter", handleVerifyMeter);
router.post("/electricity/verify", handleVerifyMeter);
router.post("/verify-meter", handleVerifyMeter);

const handleBuyElectricity =
  utilityController.buyElectricity || safe("purchaseElectricity");
router.post("/pay-electricity", verifyTransactionPin, handleBuyElectricity);
router.post("/electricity/buy", verifyTransactionPin, handleBuyElectricity);
router.post("/electricity", verifyTransactionPin, handleBuyElectricity);
router.post("/buy-electricity", verifyTransactionPin, handleBuyElectricity);

/* ======================================================
   5. NIMC & IDENTITY VALIDATION ALIASES
====================================================== */
if (nimcController.verifyNIMC) {
  router.post("/verify-nin", nimcController.verifyNIMC);
  router.post("/validate-nin", nimcController.verifyNIMC);
  router.post("/nin-verify", nimcController.verifyNIMC);
}

if (nimcController.submitNIMCRequest) {
  router.post("/nimc/submit", nimcController.submitNIMCRequest);
  router.post("/nimc-validate", nimcController.submitNIMCRequest);
} else {
  router.post("/nimc-validate", safe("nimcValidation"));
}

if (validationController.submitValidation) {
  router.post("/validation/submit", validationController.submitValidation);
  router.post("/validation/validate", validationController.submitValidation);
}

/* ======================================================
   6. TRANSACTION STATUS & HISTORY
====================================================== */
router.get("/transactions", safe("getTransactionHistory"));
router.get("/status/:reference", safe("getTransactionStatus"));
router.get("/transaction-status/:reference", safe("getTransactionStatus"));

module.exports = router;