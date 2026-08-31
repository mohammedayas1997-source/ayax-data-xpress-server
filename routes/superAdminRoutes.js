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
  authMiddleware.protect || authMiddleware.verifyToken || authMiddleware;
const authorize =
  authMiddleware.authorize ||
  authMiddleware.restrictTo ||
  ((...roles) => (req, res, next) => next());

// Ikon Admin da SuperAdmin gaba daya
const adminAndSuperAdmin = authorize("superadmin", "admin");

// 2. Controller Imports
const superAdminController = require("../controllers/superAdminController");

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
// Matches SuperAdminDashboard.js: Provision NSD, SM, Supervisor, Agent
router.post(
  "/create-user",
  safe(superAdminController.createUser, "createUser")
);

router.post(
  "/users/create",
  safe(superAdminController.createUser, "createUser")
);

// ==========================================
// 3. ALL COMPANY STAFF & USERS DIRECTORATE
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
// 4. REFUND DISPUTES QUEUE & APPROVAL ENGINE
// ==========================================
// Matches SuperAdminDashboard.js: Refunds Tab & Approval Action
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

// Executive Override Refund
router.post(
  "/refunds/executive-override",
  safe(superAdminController.approveRefund, "approveRefund")
);

router.post(
  "/process-refund",
  safe(superAdminController.approveRefund, "approveRefund")
);

// ==========================================
// 5. ALL COMPANY TRANSACTIONS (AUDIT TRAIL)
// ==========================================
// Matches SuperAdminDashboard.js: Audit Stream Tab
router.get(
  "/transactions",
  safe(superAdminController.getAllTransactions, "getAllTransactions")
);

router.get(
  "/all-transactions",
  safe(superAdminController.getAllTransactions, "getAllTransactions")
);

// ==========================================
// 6. ALL COMPANY SERVICES & TARIFFS
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
// 7. DATA PACKAGES MATRIX (GET, CREATE, UPDATE, DELETE)
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
// 8. FINANCIAL DISPATCH (DIRECT LEDGER CREDIT/DEBIT)
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
// 9. TARGET MANAGEMENT (NSD, SM, SUPERVISORS, AGENTS)
// ==========================================
router.post(
  "/assign-target",
  safe(superAdminController.assignTarget, "assignTarget")
);

// ==========================================
// 10. ROLE ELEVATION & SECURITY CONTROLS
// ==========================================
// Promote / Demote User Role
router.patch(
  "/users/change-role",
  safe(superAdminController.changeUserRole, "changeUserRole")
);

router.post(
  "/change-user-role",
  safe(superAdminController.changeUserRole, "changeUserRole")
);

// Force Override Password / PIN
router.post(
  "/users/force-reset-security",
  safe(superAdminController.forceResetUserSecurity, "forceResetUserSecurity")
);

router.post(
  "/override-password",
  safe(superAdminController.forceResetUserSecurity, "forceResetUserSecurity")
);

// Lock / Unlock / Freeze User Account
router.patch(
  "/users/toggle-lock",
  safe(superAdminController.toggleWalletLock, "toggleWalletLock")
);

router.post(
  "/toggle-suspension",
  safe(superAdminController.toggleWalletLock, "toggleWalletLock")
);

// ==========================================
// 11. BROADCAST NOTIFICATIONS & MARKETING DISPATCH
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
// 12. GLOBAL PRICING & TARIFF MATRIX OVERRIDE
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
// 13. FORENSIC AUDIT EXPUNGING
// ==========================================
router.delete(
  "/logs/expunge",
  safe(superAdminController.expungeSystemAuditLogs, "expungeSystemAuditLogs")
);

module.exports = router;