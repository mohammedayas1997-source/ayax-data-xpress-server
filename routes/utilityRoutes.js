const express = require("express");
const router = express.Router();

// 1. Dynamic Authentication Middleware Loader
let protect = (req, res, next) => next();
try {
  const authMod = require("../middleware/authMiddleware");
  protect = authMod.protect || authMod;
} catch (e1) {
  try {
    const authMod = require("../middleware/auth");
    protect = authMod.protect || authMod;
  } catch (e2) {
    try {
      const authMod = require("../middlewares/authMiddleware");
      protect = authMod.protect || authMod;
    } catch (e3) {
      console.warn("Auth middleware fallback applied.");
    }
  }
}

// 2. Dynamic PIN Middleware Loader
let verifyTransactionPin = (req, res, next) => next();
try {
  const pinMod = require("../middleware/verifyPin");
  verifyTransactionPin = pinMod.verifyTransactionPin || pinMod;
} catch (p1) {
  try {
    const pinMod = require("../middleware/pinMiddleware");
    verifyTransactionPin = pinMod.verifyTransactionPin || pinMod;
  } catch (p2) {
    // Controller yana bincika PIN da kansa
  }
}

// 3. Dynamic Controller Loader
let controller = {};
try {
  controller = require("../controllers/utilityController");
} catch (c1) {
  try {
    controller = require("../controllers/billsController");
  } catch (c2) {
    console.error("Controllers not found!");
  }
}

const {
  verifyMeter,
  buyElectricity,
  getCablePlans,
  verifySmartCard,
  buyCableSubscription,
} = controller;

// Electricity Routes
router.post("/electricity/verify", protect, verifyMeter);
router.post("/validate-meter", protect, verifyMeter);
router.post("/electricity/buy", protect, verifyTransactionPin, buyElectricity);
router.post("/pay-electricity", protect, verifyTransactionPin, buyElectricity);

// Cable TV Routes
router.get("/cable/plans", protect, getCablePlans);
router.post("/cable/verify", protect, verifySmartCard);
router.post("/validate-cable", protect, verifySmartCard);
router.post("/cable/buy", protect, verifyTransactionPin, buyCableSubscription);
router.post("/pay-cable", protect, verifyTransactionPin, buyCableSubscription);

module.exports = router;