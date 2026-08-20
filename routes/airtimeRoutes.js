const express = require("express");
const router = express.Router();
const airtimeController = require("../controllers/airtimeController");
const { protect } = require("../middlewares/authMiddleware");

router.post("/buy", protect, airtimeController.buyAirtime);

module.exports = router;