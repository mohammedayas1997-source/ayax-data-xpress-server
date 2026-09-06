const express = require("express");
const router = express.Router();

// 1. Dynamic Authentication & Authorization Middleware Loader
let authMiddleware;
try {
  authMiddleware = require("../middleware/authMiddleware");
} catch (e) {
  authMiddleware = require("../middleware/auth");
}

const protect =
  authMiddleware?.protect || authMiddleware?.verifyToken || authMiddleware;
const authorize =
  authMiddleware?.authorize ||
  authMiddleware?.restrictTo ||
  ((...roles) => (req, res, next) => next());

// Ikon Admin da SuperAdmin gaba daya
const adminAndSuperAdmin = authorize("superadmin", "admin");

// 2. Controller Imports
const superAdminController = require("../controllers/superAdminController");
let supervisorController;
try {
  supervisorController = require("../controllers/supervisorController");
} catch (_) {
  supervisorController = superAdminController;
}

// Safe Route Handler Helper
const safe = (fn, name) => {
  if (typeof fn === "function") return fn;
  return (req, res) => {
    return res.status(501).json({
      success: false,
      status: "failed",
      message: `SuperAdmin controller handler '${name}' is not implemented yet.`,
    });
  };
};

// Sanya Tsaro ga Dukkan Kofofin SuperAdmin/Admin
router.use(protect);
router.use(adminAndSuperAdmin);

// ==========================================
// 1. GLOBAL TELEMETRY & SYSTEM ANALYTICS
// ==========================================
router.get(
  "/overview",
  safe(superAdminController.getGlobalDataOverview, "getGlobalDataOverview")
);

router.get(
  "/telemetry",
  safe(superAdminController.getGlobalDataOverview, "getGlobalDataOverview")
);

router.get(
  "/stats",
  safe(superAdminController.getGlobalDataOverview, "getGlobalDataOverview")
);

// ==========================================
// 2. USER CREATION & STAFF APPOINTMENTS
// ==========================================
router.post(
  "/create-user",
  safe(superAdminController.createUser, "createUser")
);

router.post(
  "/users/create",
  safe(superAdminController.createUser, "createUser")
);

// ==========================================
// 3. AGENT TEAM REASSIGNMENT & TRANSFERS
// ==========================================
router.post(
  "/supervisors/transfer-all-agents",
  safe(
    supervisorController?.transferAllAgentsToNewSupervisor || superAdminController?.transferAllAgentsToNewSupervisor,
    "transferAllAgentsToNewSupervisor"
  )
);

router.post(
  "/supervisors/transfer-single-agent",
  safe(
    supervisorController?.transferSingleAgent || superAdminController?.transferSingleAgent,
    "transferSingleAgent"
  )
);

// ==========================================
// 4. ALL COMPANY STAFF & USERS DIRECTORATE
// ==========================================
router.get(
  "/users",
  safe(superAdminController.getAllUsers, "getAllUsers")
);

router.get(
  "/all-users",
  safe(superAdminController.getAllUsers, "getAllUsers")
);

// ==========================================
// 5. REFUND DISPUTES QUEUE & APPROVAL ENGINE
// ==========================================
router.get(
  "/refund-requests",
  safe(superAdminController.getRefundRequests, "getRefundRequests")
);

router.get(
  "/refunds/pending",
  safe(superAdminController.getRefundRequests, "getRefundRequests")
);

router.post(
  "/refunds/approve",
  safe(superAdminController.approveRefund, "approveRefund")
);

// Batch Approve Refunds (Multi-select Refund Route)
router.post(
  "/refunds/batch-approve",
  safe(
    superAdminController.batchApproveRefunds || superAdminController.approveRefund,
    "batchApproveRefunds"
  )
);

router.post(
  "/refunds/executive-override",
  safe(superAdminController.approveRefund, "approveRefund")
);

router.post(
  "/process-refund",
  safe(superAdminController.approveRefund, "approveRefund")
);

// ==========================================
// 6. ALL COMPANY TRANSACTIONS (AUDIT TRAIL)
// ==========================================
router.get(
  "/transactions",
  safe(superAdminController.getAllTransactions, "getAllTransactions")
);

router.get(
  "/all-transactions",
  safe(superAdminController.getAllTransactions, "getAllTransactions")
);

// ==========================================
// 7. ALL COMPANY SERVICES & TARIFFS
// ==========================================
router.get(
  "/services",
  safe(superAdminController.getAllCompanyServices, "getAllCompanyServices")
);

router.get(
  "/all-services",
  safe(superAdminController.getAllCompanyServices, "getAllCompanyServices")
);

// ==========================================
// 8. DATA PACKAGES MATRIX
// ==========================================
router.get(
  "/plans",
  safe(superAdminController.getAllDataPlans, "getAllDataPlans")
);

router.get(
  "/all-plans",
  safe(superAdminController.getAllDataPlans, "getAllDataPlans")
);

router.post(
  "/set-plan",
  safe(superAdminController.setDataPlan, "setDataPlan")
);

router.put(
  "/plans/:id",
  safe(superAdminController.updateDataPlan, "updateDataPlan")
);

router.delete(
  "/plans/:id",
  safe(superAdminController.deleteDataPlan, "deleteDataPlan")
);

// ==========================================
// 9. FINANCIAL DISPATCH (DIRECT LEDGER)
// ==========================================
router.post(
  "/wallet/adjust",
  safe(superAdminController.adjustUserWallet, "adjustUserWallet")
);

router.post(
  "/adjust-wallet",
  safe(superAdminController.adjustUserWallet, "adjustUserWallet")
);

// ==========================================
// 10. TARGET MANAGEMENT
// ==========================================
router.post(
  "/assign-target",
  safe(superAdminController.assignTarget, "assignTarget")
);

// ==========================================
// 11. ROLE ELEVATION & SECURITY CONTROLS
// ==========================================
router.patch(
  "/users/change-role",
  safe(superAdminController.changeUserRole, "changeUserRole")
);

router.post(
  "/change-user-role",
  safe(superAdminController.changeUserRole, "changeUserRole")
);

router.post(
  "/users/force-reset-security",
  safe(superAdminController.forceResetUserSecurity, "forceResetUserSecurity")
);

router.post(
  "/override-password",
  safe(superAdminController.forceResetUserSecurity, "forceResetUserSecurity")
);

router.patch(
  "/users/toggle-lock",
  safe(superAdminController.toggleWalletLock, "toggleWalletLock")
);

router.post(
  "/toggle-suspension",
  safe(superAdminController.toggleWalletLock, "toggleWalletLock")
);

// ==========================================
// 12. BROADCAST NOTIFICATIONS & MARKETING
// ==========================================
router.post(
  "/broadcast-notification",
  safe(superAdminController.broadcastNotification, "broadcastNotification")
);

router.post(
  "/vtu/dispatch-bulk",
  safe(superAdminController.dispatchDataBundle, "dispatchDataBundle")
);

router.post(
  "/dispatch-data",
  safe(superAdminController.dispatchDataBundle, "dispatchDataBundle")
);

// ==========================================
// 13. GLOBAL PRICING & TARIFF MATRIX
// ==========================================
router.post(
  "/pricing/set-global",
  safe(superAdminController.setGlobalServicePrice, "setGlobalServicePrice")
);

router.post(
  "/update-service-price",
  safe(superAdminController.setGlobalServicePrice, "setGlobalServicePrice")
);

// ==========================================
// 14. FORENSIC AUDIT EXPUNGING
// ==========================================
router.delete(
  "/logs/expunge",
  safe(superAdminController.expungeSystemAuditLogs, "expungeSystemAuditLogs")
);

module.exports = router;