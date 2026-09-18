const express = require("express");
const router = express.Router();

// 1. Dynamic Authentication Middleware Loader
let authMiddleware = {};
try {
  authMiddleware = require("../middleware/authMiddleware");
} catch (e) {
  try {
    authMiddleware = require("../middleware/auth");
  } catch (err) {
    console.error("Auth middleware not found, fallback to denial.");
  }
}

// Ensure middleware is always a valid function
const protect =
  authMiddleware.protect ||
  authMiddleware.verifyToken ||
  (typeof authMiddleware === "function"
    ? authMiddleware
    : (req, res, next) => {
        return res.status(401).json({ success: false, message: "Authentication required." });
      });

const authorize =
  authMiddleware.authorize ||
  authMiddleware.restrictTo ||
  ((...roles) => (req, res, next) => next());

// 2. Controller Imports
let adminController = {};
try {
  adminController = require("../controllers/adminController");
} catch (e) {
  console.warn("adminController not found.");
}

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
router.get("/stats", safe(adminController.getDashboardStats, "getDashboardStats"));
router.get("/dashboard-stats", safe(adminController.getDashboardStats, "getDashboardStats"));
router.get("/overview", safe(adminController.getDashboardStats, "getDashboardStats"));

// ==========================================
// 2. TRANSACTION LOGS & CASHFLOW STREAM
// ==========================================
router.get("/transactions", safe(adminController.getAllTransactions, "getAllTransactions"));
router.get("/all-transactions", safe(adminController.getAllTransactions, "getAllTransactions"));

// ==========================================
// 3. USER, CADRE HIERARCHY & DIRECTIVES
// ==========================================
router.get("/users", safe(adminController.getAllUsers, "getAllUsers"));
router.post("/users/create", safe(adminController.createUserByAdmin, "createUserByAdmin"));
router.post("/create-user", safe(adminController.createUserByAdmin, "createUserByAdmin"));
router.put("/users/:id/status", safe(adminController.updateUserStatusByAdmin, "updateUserStatusByAdmin"));
router.patch("/users/:id/status", safe(adminController.updateUserStatusByAdmin, "updateUserStatusByAdmin"));

router.get("/supervisors", safe(adminController.getSupervisors, "getSupervisors"));
router.get("/agents", safe(adminController.getAgents, "getAgents"));

router.route("/assign-target")
  .put(safe(adminController.assignTarget, "assignTarget"))
  .post(safe(adminController.assignTarget, "assignTarget"));

router.post("/targets/assign", safe(adminController.assignTarget, "assignTarget"));

router.route("/suspend-user/:id")
  .patch(safe(adminController.suspendUser, "suspendUser"))
  .put(safe(adminController.suspendUser, "suspendUser"));

// ==========================================
// 4. DATA TARIFFS & PLANS (CRUD)
// ==========================================
router.get("/pricing/plans", safe(adminController.getDataPlans, "getDataPlans"));
router.post("/pricing/create-plan", safe(adminController.createDataPlan, "createDataPlan"));
router.post("/pricing/update-tier", safe(adminController.updateTierPricing, "updateTierPricing"));
router.post("/pricing/update", safe(adminController.updateTierPricing, "updateTierPricing"));

router.delete(
  "/pricing/delete-plan/:id",
  safe(adminController.deleteDataPlan || dataPlanController.deletePlan, "deleteDataPlan")
);

// Legacy Plan Compatibility Endpoints
router.get(
  "/plans",
  safe(
    adminController.getDataPlans ||
      dataPlanController.getAdminPlans ||
      dataPlanController.getPlans,
    "getDataPlans"
  )
);

router.post(
  "/set-plan",
  safe(
    adminController.updateTierPricing ||
      dataPlanController.setPlanPrice ||
      dataPlanController.createPlan,
    "setPlanPrice"
  )
);

router.put(
  "/plans/:id",
  safe(
    adminController.updateTierPricing ||
      dataPlanController.setPlanPrice ||
      dataPlanController.updatePlan,
    "updatePlan"
  )
);

router.delete(
  "/plans/:id",
  safe(adminController.deleteDataPlan || dataPlanController.deletePlan, "deleteDataPlan")
);

router.post("/plans/sync-ayax", safe(dataPlanController.syncAyaxPlans, "syncAyaxPlans"));
router.patch("/plans/:id/toggle", safe(dataPlanController.togglePlanStatus, "togglePlanStatus"));

// ==========================================
// 5. BROADCAST & PUSH NOTIFICATIONS
// ==========================================
router.post("/notifications/broadcast", safe(adminController.broadcastNotification, "broadcastNotification"));
router.post("/notifications/send", safe(adminController.broadcastNotification, "broadcastNotification"));

// ==========================================
// 6. REFUND PROCESSING & SETTLEMENT
// ==========================================
router.get("/pending-refunds", safe(adminController.getPendingRefunds, "getPendingRefunds"));
router.get("/refunds/pending", safe(adminController.getPendingRefunds, "getPendingRefunds"));

// Single Refund Execution
router.route("/approve-refund/:id")
  .post(safe(adminController.approveRefund, "approveRefund"))
  .patch(safe(adminController.approveRefund, "approveRefund"));

router.route("/refunds/approve")
  .post(safe(adminController.approveRefund, "approveRefund"));

// Batch Approve Multiple Refunds in One Click
router.post(
  "/refunds/batch-approve",
  safe(adminController.batchApproveRefunds, "batchApproveRefunds")
);

// ==========================================
// 7. FORENSIC AUDIT TRAIL & ACTIVITIES
// ==========================================
router.get("/activities", safe(adminController.getSupportActivities, "getSupportActivities"));
router.get("/support-activities", safe(adminController.getSupportActivities, "getSupportActivities"));

// ==========================================
// 8. NIMC & NIN SERVICES OVERSIGHT
// ==========================================
router.get("/nimc-requests", safe(adminController.getAllNIMCRequests, "getAllNIMCRequests"));
router.get("/nimc/requests", safe(adminController.getAllNIMCRequests, "getAllNIMCRequests"));

router.route("/approve-nimc/:id")
  .patch(safe(adminController.approveRequest, "approveRequest"))
  .put(safe(adminController.approveRequest, "approveRequest"));

router.get("/pricing/nimc", safe(adminController.getNIMCPrice, "getNIMCPrice"));

router.post(
  "/nin/update-price",
  safe(adminController.updateNinPrice, "updateNinPrice")
);

router.post(
  "/nimc/admin/set-price",
  safe(adminController.updateNinPrice, "updateNinPrice")
);

// ==========================================
// 9. BVN REQUESTS & VERIFICATIONS
// ==========================================
router.get("/bvn-requests", safe(adminController.getAllBVNRequests, "getAllBVNRequests"));
router.get("/bvn/requests", safe(adminController.getAllBVNRequests, "getAllBVNRequests"));

router.route("/approve-bvn/:id")
  .patch(safe(adminController.approveBVNRequest, "approveBVNRequest"))
  .put(safe(adminController.approveBVNRequest, "approveBVNRequest"));

router.get("/pricing/bvn", safe(adminController.getBVNPrice, "getBVNPrice"));

module.exports = router;