const express = require("express");
const router = express.Router();

// Tabbatar hanya da sunan controller din sun daidaita:
const {
  verifyMeter,
  buyElectricity,
  getCablePlans,
  verifySmartCard,
  buyCableSubscription,
} = require("../controllers/billsController"); // <-- Duba idan billsController ne ko utilityController

const { protect } = require("../middleware/auth");
const { verifyTransactionPin } = require("../middleware/verifyPin");

// Electricity Routes
router.post("/electricity/verify", protect, verifyMeter);
router.post("/validate-meter", protect, verifyMeter);
router.post("/electricity/buy", protect, verifyTransactionPin, buyElectricity);
router.post("/pay-electricity", protect, verifyTransactionPin, buyElectricity);

// Cable TV Routes
router.get("/cable/plans", protect, getCablePlans);

// Validation Aliases (Daidai da kiran da browser ke yi a hotunanka)
router.post("/cable/verify", protect, verifySmartCard);
router.post("/validate-cable", protect, verifySmartCard);

// Purchase Aliases
router.post("/cable/buy", protect, verifyTransactionPin, buyCableSubscription);
router.post("/pay-cable", protect, verifyTransactionPin, buyCableSubscription);

module.exports = router;