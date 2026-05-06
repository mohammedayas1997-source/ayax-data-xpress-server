const express = require("express");
const router = express.Router();

// 1. Import Controllers
const {
  searchUser,
  requestRefund,
  getUserTransactionHistory,
  getRefundStatus,
  traceServiceRequest, // Added this to match the new controller function
} = require("../controllers/supportController");

// 2. Import Middlewares
const { protect, authorize } = require("../middleware/authMiddleware");

// --- SUPPORT ROUTES CONFIGURATION ---

// Apply protection to all routes below
router.use(protect);

// Restrict access to specific roles (Support, Admin, and Superadmin)
router.use(authorize("support", "admin", "superadmin"));

/**
 * Service Tracing
 * @route  GET /api/v1/support/trace/:type/:identifier
 * @desc   Trace BVN or NIMC requests using ID, Phone, or Number
 */
router.get("/trace/:type/:identifier", traceServiceRequest);

/**
 * User Management & Search
 */
router.get("/search-user/:identifier", searchUser);
router.get("/user-transactions/:userId", getUserTransactionHistory);

/**
 * Refund Management
 */
router.post("/request-refund", requestRefund);
router.get("/refund-status/:transactionId", getRefundStatus);

module.exports = router;
