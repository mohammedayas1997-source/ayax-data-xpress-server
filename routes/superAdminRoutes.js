const express = require("express");
const router = express.Router();

const { protect, authorize } = require("../middleware/authMiddleware");
const superAdminController = require("../controllers/superAdminController") || {};

const safe = (fn, name) => {
  if (typeof fn === "function") return fn;
  return (req, res) => {
    res.status(501).json({
      success: false,
      message: `SuperAdmin function '${name}' is not implemented yet.`,
    });
  };
};

// Kariya: SuperAdmin KAWAI ke da izinin shiga nan
if (typeof protect === "function") router.use(protect);
if (typeof authorize === "function") router.use(authorize("superadmin"));

// --- 1. SYSTEM STATS & AUDIT LOGS ---
router.get("/stats", safe(superAdminController.getSystemStats, "getSystemStats"));
router.get("/audit-logs", safe(superAdminController.getAuditLogs, "getAuditLogs"));

// --- 2. STAFF & ROLE MANAGEMENT ---
router.patch("/manage-role", safe(superAdminController.manageUserRole, "manageUserRole"));
router.post("/make-admin", safe(superAdminController.makeAdmin, "makeAdmin"));
router.post("/create-staff", safe(superAdminController.createStaff, "createStaff"));

// --- 3. WALLET OVERRIDE (CREDIT & DEBIT) ---
router.post("/credit-user", safe(superAdminController.creditUser, "creditUser"));
router.post("/debit-user", safe(superAdminController.debitUser, "debitUser"));

// --- 4. AUTOMATIC DATA DISPATCH (SINGLE / BULK / ALL USERS) ---
router.post("/dispatch-data", safe(superAdminController.dispatchData, "dispatchData"));

module.exports = router;