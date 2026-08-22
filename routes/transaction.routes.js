const express = require("express");
const router = express.Router();
const transactionController = require("../controllers/transactionController");

// Dynamic fallback domin dauko auth middleware ko da wane suna yake dashi a project din
let authMiddleware;
try {
  authMiddleware = require("../middlewares/auth.middleware");
} catch (e) {
  try {
    authMiddleware = require("../middlewares/auth");
  } catch (err) {
    try {
      authMiddleware = require("../middleware/auth");
    } catch (finalErr) {
      authMiddleware = require("../middlewares/authMiddleware");
    }
  }
}

const verifyToken =
  authMiddleware.verifyToken ||
  authMiddleware.authenticate ||
  authMiddleware.protect ||
  authMiddleware.auth ||
  authMiddleware;

const verifyAdmin =
  authMiddleware.verifyAdmin ||
  authMiddleware.isAdmin ||
  authMiddleware.adminOnly ||
  ((req, res, next) => {
    if (req.user && (req.user.role === "admin" || req.user.role === "ADMIN")) {
      return next();
    }
    return res.status(403).json({ success: false, message: "Admin access required" });
  });

// ==========================================
// 1. USER ROUTES
// ==========================================
router.get("/my-history", verifyToken, transactionController.getUserTransactions);

// ==========================================
// 2. ADMIN ROUTES
// ==========================================
router.get("/all", verifyToken, verifyAdmin, transactionController.getAllTransactions);
router.get("/stats", verifyToken, verifyAdmin, transactionController.getTransactionStats);
router.post("/refund", verifyToken, verifyAdmin, transactionController.refundTransaction);
router.get("/:identifier", verifyToken, transactionController.getTransactionDetails);

module.exports = router;