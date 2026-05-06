const express = require("express");
const router = express.Router();
const {
  getBVNPrices,
  setBVNPrice,
  verifyBVN,
} = require("../controllers/bvnController");

// Middleware for authentication and authorization
const { protect, adminOnly } = require("../middleware/authMiddleware");

/**
 * Public/Protected Routes for BVN
 */

// Route to get all BVN prices
router.get("/prices", protect, getBVNPrices);

// Route to initiate BVN verification
router.post("/verify", protect, verifyBVN);

/**
 * Admin Only Routes
 */

// Route to set or update BVN service prices
router.post("/admin/set-price", protect, adminOnly, setBVNPrice);

module.exports = router;
