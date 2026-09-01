const express = require("express");
const router = express.Router();

// 1. Dynamic Authentication Middleware Loader
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

// 2. Controller Imports
const adminController = require("../controllers/adminController") || {};

let dataPlanController = {};
try {
  dataPlanController = require("../controllers/dataPlanController");
} catch (e) {
  try {
    dataPlanController = require("../controllers/data.controller");
  } catch (err) {
    dataPlanController = {};
  }
}

// Safe Route Handler Helper
const safe = (fn, name) => {
  if (typeof fn === "function") return fn;
  return (req, res) => {
    return res.status(501).json({
      success: false,
      status: "failed",
      message: `Admin controller handler '${name}' is not implemented yet.`,
    });
  };
};

// ==========================================
// ACCESS CONTROL: PROTECT ALL ADMIN ROUTES
// ==========================================
router.use(protect);
router.use(authorize("admin", "superadmin"));

// ==========================================
// 1. DASHBOARD ANALYTICS & TELEMETRY
// ==========================================
router.get(
  "/stats",
  safe(adminController.getDashboardStats, "getDashboardStats")
);
router.get(
  "/dashboard-stats",
  safe(adminController.getDashboardStats, "getDashboardStats")
);

// ==========================================
// 2. TRANSACTION LOGS & AUDITING
// ==========================================
router.get(
  "/transactions",
  safe(adminController.getAllTransactions, "getAllTransactions")
);
router.get(
  "/all-transactions",
  safe(adminController.getAllTransactions, "getAllTransactions")
);

// ==========================================
// 3. USER, CADRE HIERARCHY & DIRECTIVES
// ==========================================
router.get("/users", safe(adminController.getAllUsers, "getAllUsers"));
router.post(
  "/users/create",
  safe(adminController.createUserByAdmin, "createUserByAdmin")
);
router.put(
  "/users/:id/status",
  safe(adminController.updateUserStatusByAdmin, "updateUserStatusByAdmin")
);

router.get(
  "/supervisors",
  safe(adminController.getSupervisors, "getSupervisors")
);
router.get("/agents", safe(adminController.getAgents, "getAgents"));

router.put(
  "/assign-target",
  safe(adminController.assignTarget, "assignTarget")
);
router.post(
  "/assign-target",
  safe(adminController.assignTarget, "assignTarget")
);
router.post(
  "/targets/assign",
  safe(adminController.assignTarget, "assignTarget")
);

router.patch(
  "/suspend-user/:id",
  safe(adminController.suspendUser, "suspendUser")
);
router.put(
  "/suspend-user/:id",
  safe(adminController.suspendUser, "suspendUser")
);

// ==========================================
// 4. SUPER ADMIN TARIFFS & MULTI-TIER PRICING
// ==========================================
router.get(
  "/pricing/plans",
  safe(adminController.getDataPlans, "getDataPlans")
);
router.post(
  "/pricing/update-tier",
  safe(adminController.updateTierPricing, "updateTierPricing")
);
router.post(
  "/pricing/update",
  safe(adminController.updateTierPricing, "updateTierPricing")
);
router.post(
  "/pricing/create-plan",
  safe(adminController.createDataPlan, "createDataPlan")
);

// ==========================================
// 5. BROADCAST & PUSH NOTIFICATIONS
// ==========================================
router.post(
  "/notifications/broadcast",
  safe(adminController.broadcastNotification, "broadcastNotification")
);

// ==========================================
// 6. REFUND PROCESSING & SETTLEMENT
// ==========================================
router.get(
  "/pending-refunds",
  safe(adminController.getPendingRefunds, "getPendingRefunds")
);
router.get(
  "/refunds/pending",
  safe(adminController.getPendingRefunds, "getPendingRefunds")
);

router.post(
  "/approve-refund/:id",
  safe(adminController.approveRefund, "approveRefund")
);
router.patch(
  "/approve-refund/:id",
  safe(adminController.approveRefund, "approveRefund")
);

// ==========================================
// 7. FORENSIC AUDIT TRAIL & ACTIVITIES
// ==========================================
router.get(
  "/activities",
  safe(adminController.getSupportActivities, "getSupportActivities")
);
router.get(
  "/support-activities",
  safe(adminController.getSupportActivities, "getSupportActivities")
);

// ==========================================
// 8. NIMC REQUESTS & VERIFICATIONS
// ==========================================
router.get(
  "/nimc-requests",
  safe(adminController.getAllNIMCRequests, "getAllNIMCRequests")
);
router.get(
  "/nimc/requests",
  safe(adminController.getAllNIMCRequests, "getAllNIMCRequests")
);

router.patch(
  "/approve-nimc/:id",
  safe(adminController.approveRequest, "approveRequest")
);
router.put(
  "/approve-nimc/:id",
  safe(adminController.approveRequest, "approveRequest")
);

router.get(
  "/pricing/nimc",
  safe(adminController.getNIMCPrice, "getNIMCPrice")
);

// ==========================================
// 9. BVN REQUESTS & VERIFICATIONS
// ==========================================
router.get(
  "/bvn-requests",
  safe(adminController.getAllBVNRequests, "getAllBVNRequests")
);
router.get(
  "/bvn/requests",
  safe(adminController.getAllBVNRequests, "getAllBVNRequests")
);

router.patch(
  "/approve-bvn/:id",
  safe(adminController.approveBVNRequest, "approveBVNRequest")
);
router.put(
  "/approve-bvn/:id",
  safe(adminController.approveBVNRequest, "approveBVNRequest")
);

router.get(
  "/pricing/bvn",
  safe(adminController.getBVNPrice, "getBVNPrice")
);

// ==========================================
// 10. LEGACY DATA PLANS INTEGRATION
// ==========================================
router.get(
  "/plans",
  safe(
    dataPlanController.getAdminPlans ||
      dataPlanController.getActivePlans ||
      dataPlanController.getPlans ||
      adminController.getDataPlans,
    "getAdminPlans"
  )
);

router.post(
  "/set-plan",
  safe(
    dataPlanController.setPlanPrice ||
      dataPlanController.createPlan ||
      adminController.updateTierPricing,
    "setPlanPrice"
  )
);

router.post(
  "/plans/sync-ayax",
  safe(dataPlanController.syncAyaxPlans, "syncAyaxPlans")
);

router.patch(
  "/plans/:id/toggle",
  safe(dataPlanController.togglePlanStatus, "togglePlanStatus")
);

router.put(
  "/plans/:id",
  safe(
    dataPlanController.setPlanPrice ||
      dataPlanController.updatePlan ||
      adminController.updateTierPricing,
    "updatePlan"
  )
);

router.delete(
  "/plans/:id",
  safe(dataPlanController.deletePlan, "deletePlan")
);

module.exports = router;