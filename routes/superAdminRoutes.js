const express = require("express");
const router = express.Router();

// Duba sunan Controller din ya dace da yadda yake a folder (Case-sensitive)
const {
  getSystemStats,
  makeAdmin,
  getAllGlobalTransactions,
  getAuditLogs,
  manageUserRole,
} = require("../controllers/superAdminController");

const { protect, authorize } = require("../middleware/authMiddleware");

// Takaita dukkan wadannan routes ga Super Admin kadai
router.use(protect);
router.use(authorize("superadmin"));

// 1. Dashboard & Statistics
router.get("/stats", getSystemStats);

// 2. Global Monitoring (Ganin ayyukan kowa)
router.get("/transactions/all", getAllGlobalTransactions); // Ganin duk wani ciniki na kowa
router.get("/audit-logs", getAuditLogs); // Ganin abubuwan da Admins/Staff suka yi

// 3. User & Admin Management
router.post("/make-admin", makeAdmin); // Tsohon hanyar da ka rubuta
router.put("/manage-role", manageUserRole); // Sabon hanyar canza role na kowa

module.exports = router;
