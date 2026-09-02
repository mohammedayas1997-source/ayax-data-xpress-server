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

// Electricity
router.post("/electricity/verify", protect, verifyMeter);
router.post("/validate-meter", protect, verifyMeter); // Alias don frontend
router.post("/electricity/buy", protect, verifyTransactionPin, buyElectricity);

// Cable TV
router.get("/cable/plans", protect, getCablePlans);
router.post("/cable/verify", protect, verifySmartCard);
router.post("/validate-cable", protect, verifySmartCard); // ✅ Wannan zai magance error din
router.post("/cable/buy", protect, verifyTransactionPin, buyCableSubscription);

module.exports = router;