const express = require("express");
const router = express.Router();

// 1. Middlewares
const { protect, authorize } = require("../middleware/authMiddleware");

// 2. Controllers
const adminController = require("../controllers/adminController") || {};
const dataPlanController = require("../controllers/dataPlanController") || {};

// Safe Handler Helper don hana server faduwa idan function bashi da definition
const safe = (fn, name) => {
  if (typeof fn === "function") return fn;
  return (req, res) => {
    res.status(501).json({
      success: false,
      message: `Controller function '${name}' is not implemented yet.`,
    });
  };
};

// --- ADMIN PROTECTION ---
if (typeof protect === "function") router.use(protect);
if (typeof authorize === "function") router.use(authorize("admin", "superadmin"));

// --- 3. USER MANAGEMENT ---
router.get("/users", safe(adminController.getAllUsers || adminController.getUsers, "getAllUsers"));
router.get("/supervisors", safe(adminController.getSupervisors, "getSupervisors"));
router.get("/agents", safe(adminController.getAgents, "getAgents"));
router.put("/assign-target", safe(adminController.assignTarget, "assignTarget"));
router.patch("/suspend-user/:id", safe(adminController.suspendUser, "suspendUser"));
router.patch("/update-role", safe(adminController.updateUserRole, "updateUserRole"));

// --- NEW ADMIN POWERS ---
router.patch("/toggle-wallet-status", safe(adminController.toggleWalletStatus, "toggleWalletStatus"));
router.post("/debit-user", safe(adminController.debitUser, "debitUser"));
router.post("/credit-user", safe(adminController.creditUser, "creditUser"));

// --- 4. REFUND MANAGEMENT ---
router.get("/pending-refunds", safe(adminController.getPendingRefunds, "getPendingRefunds"));
router.post("/approve-refund/:id", safe(adminController.approveRefund, "approveRefund"));

// --- 5. ACTIVITY LOGS & SUPPORT ---
router.get("/activities", safe(adminController.getSupportActivities, "getSupportActivities"));
router.get("/track-transaction/:transactionId", safe(adminController.trackTransaction, "trackTransaction"));
router.post("/request-admin-fix", safe(adminController.requestAdminFix, "requestAdminFix"));
router.get("/all-reports", safe(adminController.getSupportRequests, "getSupportRequests"));
router.patch("/handle-report", safe(adminController.handleSupportRequest, "handleSupportRequest"));

// --- 6. NIMC MANAGEMENT ROUTES ---
router.get("/nimc-requests", safe(adminController.getAllNIMCRequests, "getAllNIMCRequests"));
router.patch("/nimc-processing/:id", safe(adminController.updateToProcessing, "updateToProcessing"));
router.patch("/approve-nimc/:id", safe(adminController.approveRequest, "approveRequest"));

// --- 7. BVN MANAGEMENT ROUTES ---
router.get("/bvn-requests", safe(adminController.getAllBVNRequests, "getAllBVNRequests"));
router.patch("/bvn-processing/:id", safe(adminController.updateBVNStatus, "updateBVNStatus"));
router.patch("/approve-bvn/:id", safe(adminController.approveBVNRequest, "approveBVNRequest"));

// --- 8. DATA PLANS & MANAGEMENT ROUTES ---
router.get("/plans", safe(dataPlanController.getAdminPlans || dataPlanController.getPlans, "getAdminPlans"));
router.post("/set-plan", safe(dataPlanController.setPlanPrice, "setPlanPrice"));
router.post("/sync-plans", safe(dataPlanController.syncAyaxPlans, "syncAyaxPlans"));
router.patch("/plans/:id/toggle", safe(dataPlanController.togglePlanStatus, "togglePlanStatus"));
router.delete("/plans/:id", safe(dataPlanController.deletePlan, "deletePlan"));

module.exports = router;