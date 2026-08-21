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
} = require("../controllers/vtuController");

const { protect } = require("../middleware/authMiddleware");

// --- VTU SERVICES ROUTES ---

// Duk wadannan routes din sai wanda ya yi login (protect) zai iya amfani da su
router.use(protect);
/* ======================================================
   AUTHENTICATED VTU ROUTES
====================================================== */
router.use(auth);

// 1. Data Services (Dukkan hanyoyin da frontend ke iya kira)
router.post("/buy-data", buyData);
router.post("/data", buyData);
router.post("/data/buy", buyData);
router.post("/buy", buyData);

// 2. Airtime Services
router.post("/buy-airtime", buyAirtime);
router.post("/airtime", buyAirtime);
router.post("/airtime/buy", buyAirtime);

// 3. Utility Bills (Electricity & Cable TV)
router.post("/electricity", purchaseElectricity);
router.post("/buy-electricity", purchaseElectricity);
router.post("/cable", purchaseCable);
router.post("/buy-cable", purchaseCable);

// 4. Verification & Validation Services (Meter, SmartCard, NIMC)
router.post("/verify-meter", verifyMeter);
router.post("/verify-smartcard", verifySmartCard);
router.post("/nimc-validate", nimcValidation);

// 5. Status Tracking & Transaction Verification
if (typeof vtuController.getTransactionHistory === "function") {
  router.get("/transactions", vtuController.getTransactionHistory);
}

// Transaction Status
if (typeof vtuController.getTransactionStatus === "function") {
  router.get("/status/:reference", vtuController.getTransactionStatus);
  router.get("/transaction-status/:reference", vtuController.getTransactionStatus);
}

module.exports = router;