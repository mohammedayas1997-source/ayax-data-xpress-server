const express = require("express");
const router = express.Router();
const {
  verifyMeter,
  buyElectricity,
  getCablePlans,
  verifySmartCard,
  buyCableSubscription,
} = require("../controllers/utilityController");
const { protect } = require("../middleware/auth");
const { verifyTransactionPin } = require("../middleware/verifyPin");

// Electricity Routes
router.post("/electricity/verify", protect, verifyMeter);
router.post("/validate-meter", protect, verifyMeter); // Alias don frontend
router.post("/electricity/buy", protect, verifyTransactionPin, buyElectricity);
router.post("/pay-electricity", protect, verifyTransactionPin, buyElectricity); // Alias don frontend

// Cable TV Routes
router.get("/cable/plans", protect, getCablePlans);

// 1. Validation Aliases (Daidai da hoton farko da na biyu)
router.post("/cable/verify", protect, verifySmartCard);
router.post("/validate-cable", protect, verifySmartCard);

// 2. Payment Aliases (Daidai da hoton PIN: POST /api/v1/vtu/pay-cable)
router.post("/cable/buy", protect, verifyTransactionPin, buyCableSubscription);
router.post("/pay-cable", protect, verifyTransactionPin, buyCableSubscription);

module.exports = router;