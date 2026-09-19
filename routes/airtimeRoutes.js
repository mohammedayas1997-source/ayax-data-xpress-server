const express = require("express");
const router = express.Router();
const airtimeController = require("../controllers/airtimeController");

// Kariya wajen shigo da authMiddleware ko da folder tana da 's' ko babu
let protect;
try {
  protect = require("../middleware/authMiddleware").protect;
} catch (e) {
  try {
    protect = require("../middlewares/authMiddleware").protect;
  } catch (err) {
    protect = require("../middleware/auth").protect;
  }
}

// Duk kiran airtime yana bukatar login
if (protect) {
  router.use(protect);
}

// Hanyoyin da frontend ko mobile app za su iya kira
router.post("/buy", airtimeController.buyAirtime);
router.post("/buy-airtime", airtimeController.buyAirtime);
router.post("/", airtimeController.buyAirtime);

module.exports = router;