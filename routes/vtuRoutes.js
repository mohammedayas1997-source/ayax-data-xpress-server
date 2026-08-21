const express = require("express");
const router = express.Router();

const {
  buyData,
  buyAirtime,
  purchaseElectricity,
  purchaseCable,
  nimcValidation,
  verifyMeter,
  verifySmartCard,
  getTransactionStatus,
  getTransactionHistory,
} = require("../controllers/vtuController");

const { protect } = require("../middleware/authMiddleware");

// Duk waɗannan routes ɗin suna buƙatar login
router.use(protect);

/* ======================================================
   1. DATA SERVICES
====================================================== */
router.post("/buy-data", buyData);
router.post("/data", buyData);
router.post("/data/buy", buyData);
router.post("/buy", buyData);

/* ======================================================
   2. AIRTIME SERVICES
====================================================== */
router.post("/buy-airtime", buyAirtime);
router.post("/airtime", buyAirtime);
router.post("/airtime/buy", buyAirtime);

/* ======================================================
   3. UTILITY BILLS (ELECTRICITY & CABLE)
====================================================== */
router.post("/electricity", purchaseElectricity);
router.post("/buy-electricity", purchaseElectricity);
router.post("/cable", purchaseCable);
router.post("/buy-cable", purchaseCable);

/* ======================================================
   4. VERIFICATION & VALIDATION
====================================================== */
router.post("/verify-meter", verifyMeter);
router.post("/verify-smartcard", verifySmartCard);
router.post("/nimc-validate", nimcValidation);

/* ======================================================
   5. TRANSACTION STATUS & HISTORY
====================================================== */
if (typeof getTransactionHistory === "function") {
  router.get("/transactions", getTransactionHistory);
}

if (typeof getTransactionStatus === "function") {
  router.get("/status/:reference", getTransactionStatus);
  router.get("/transaction-status/:reference", getTransactionStatus);
}

module.exports = router;