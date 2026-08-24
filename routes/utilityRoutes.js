const express = require("express");
const router = express.Router();
const {
  verifyMeter,
  buyElectricity,
  getCablePlans,
  verifySmartCard,
  buyCableSubscription,
} = require("../controllers/utilityController");
const { protect } = require("../middleware/auth"); // your auth middleware

// Electricity
router.post("/electricity/verify", protect, verifyMeter);
router.post("/electricity/buy", protect, buyElectricity);

// Cable TV
router.get("/cable/plans", protect, getCablePlans);
router.post("/cable/verify", protect, verifySmartCard);
router.post("/cable/buy", protect, buyCableSubscription);

module.exports = router;