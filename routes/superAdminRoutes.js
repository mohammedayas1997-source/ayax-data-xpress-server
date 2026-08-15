const express = require("express");
const router = express.Router();

// Tabbatar da cewa sunayen controllers din sun yi daidai da yadda suke a cikin superAdminController.js
const {
  getSystemStats,
  makeAdmin,
  getAllGlobalTransactions,
  getAuditLogs,
  manageUserRole,
} = require("../controllers/superAdminController");

const { protect, authorize } = require("../middleware/authMiddleware");

// Duk wani route dake kasa yana bukatar authentication da kuma izinin Super Admin
router.use(protect);
router.use(authorize("superadmin"));

// 1. Dashboard & System Statistics
router.get("/stats", getSystemStats);

// 2. Global Monitoring (Ganin ayyukan kowa a tsarin)
router.get("/transactions/all", getAllGlobalTransactions); // Ganin duk wani ciniki (transactions) na kowa
router.get("/audit-logs", getAuditLogs); // Ganin duk wani aiki ko motsi (audit trails) na Admins da Staff

// 3. User & Admin Management
router.post("/make-admin", makeAdmin); // Sanya mai amfani ya zama Admin
router.put("/manage-role", manageUserRole); // Canza matsayi (role) na kowane mai amfani ko ma'aikaci a cikin tsarin

module.exports = router;