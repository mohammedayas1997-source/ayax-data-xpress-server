const express = require("express");
const router = express.Router();
const transactionController = require("../controllers/transactionController");
const { verifyToken, verifyAdmin } = require("../middlewares/auth.middleware");

// ==========================================
// 1. USER ROUTES (Tarihin mai amfani na kansa)
// ==========================================

// Duba tarihin transactions na mai amfani da ya shiga (User History)
router.get("/my-history", verifyToken, transactionController.getUserTransactions);

// ==========================================
// 2. ADMIN ROUTES (Gudanarwar Admin Dashboard)
// ==========================================

// Duba dukkan transactions na kowa da kowa (Admin List + Filters)
router.get("/all", verifyToken, verifyAdmin, transactionController.getAllTransactions);

// Duba kididdigar kudi da nasarar transactions (Admin Stats)
router.get("/stats", verifyToken, verifyAdmin, transactionController.getTransactionStats);

// Mayar wa user da kudinsa a wallet (Manual Admin Refund)
router.post("/refund", verifyToken, verifyAdmin, transactionController.refundTransaction);

// Duba cikakken bayanin transaction guda daya ta ID ko Reference
router.get("/:identifier", verifyToken, transactionController.getTransactionDetails);

module.exports = router;