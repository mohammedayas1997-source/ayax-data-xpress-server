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
  getTransactionStatus, // Sabo
} = require("../controllers/vtuController");

const { protect } = require("../middleware/authMiddleware");

// --- VTU SERVICES ROUTES ---

// Duk wadannan routes din sai wanda ya yi login (protect)
router.use(protect);

// 1. Data & Airtime
router.post("/buy-data", buyData);
router.post("/buy-airtime", buyAirtime);

// 2. Utility Bills (Electricity & Cable TV)
router.post("/electricity", purchaseElectricity);
router.post("/cable", purchaseCable);

// 3. Verification Services
router.post("/verify-meter", verifyMeter);
router.post("/verify-smartcard", verifySmartCard);
router.post("/nimc-validate", nimcValidation);

// 4. Status Tracking
router.get("/status/:reference", getTransactionStatus);

module.exports = router;
