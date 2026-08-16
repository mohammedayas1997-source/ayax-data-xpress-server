const express = require("express");
const router = express.Router();
const {
  getBVNPrices,
  setBVNPrice,
  verifyBVN,
} = require("../controllers/bvnController");

// Middleware for authentication and authorization
const { protect, authorize } = require("../middleware/authMiddleware");

/**
 * Protected Routes for BVN
 */

// Route to get all BVN prices
router.get("/prices", protect, getBVNPrices);

// Route to initiate BVN verification via Ayax APIs (Tallafawa POST da PUT idan aka buƙata)
router.post("/verify", protect, verifyBVN);
router.put("/verify", protect, verifyBVN);

/**
 * Admin Only Routes
 */

// Route to set or update BVN service prices (Tallafawa POST da PUT don guje wa kuskuren Frontend)
router.post("/admin/set-price", protect, authorize("admin", "superadmin"), setBVNPrice);
router.put("/admin/set-price", protect, authorize("admin", "superadmin"), setBVNPrice);

module.exports = router;