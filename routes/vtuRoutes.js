const express = require("express");
const router = express.Router();
const vtuController = require("../controllers/vtuController");
const { protect } = require("../middleware/authMiddleware");
const { verifyTransactionPin } = require("../middleware/verifyPin");
const { buyAirtime } = require("../controllers/airtimeController");
const { buyData } = require("../controllers/dataController");

// Import Utility & NIMC Controllers kai tsaye
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
   1. DATA SERVICES
====================================================== */
router.post("/buy-data", verifyTransactionPin, buyData);
router.post("/buy-data-custom", verifyTransactionPin, buyData);
router.post("/data", verifyTransactionPin, buyData);
router.post("/data/buy", verifyTransactionPin, buyData);
router.post("/buy", verifyTransactionPin, buyData);

/* ======================================================
   2. AIRTIME SERVICES
====================================================== */
router.post("/buy-airtime", verifyTransactionPin, buyAirtime);
router.post("/airtime", verifyTransactionPin, buyAirtime);
router.post("/airtime/buy", verifyTransactionPin, buyAirtime);

/* ======================================================
   3. CABLE TV (VALIDATION & PAYMENT DA FRONTEND KE KIRA)
====================================================== */
// Validation Aliases
const handleVerifySmartcard =
  utilityController.verifySmartCard || safe("verifySmartCard");
router.post("/validate-cable", handleVerifySmartcard);
router.post("/cable/verify", handleVerifySmartcard);
router.post("/verify-smartcard", handleVerifySmartcard);

// Payment Aliases (PIN modal: POST /api/v1/vtu/pay-cable)
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
  router.post("/nimc/submit", verifyTransactionPin, nimcController.submitNIMCRequest);
  router.post("/nimc-validate", verifyTransactionPin, nimcController.submitNIMCRequest);
} else {
  router.post("/nimc-validate", safe("nimcValidation"));
}

if (validationController.submitValidation) {
  router.post("/validation/submit", verifyTransactionPin, validationController.submitValidation);
  router.post("/validation/validate", verifyTransactionPin, validationController.submitValidation);
}

/* ======================================================
   6. TRANSACTION STATUS & HISTORY
====================================================== */
router.get("/transactions", safe("getTransactionHistory"));
router.get("/status/:reference", safe("getTransactionStatus"));
router.get("/transaction-status/:reference", safe("getTransactionStatus"));

module.exports = router;