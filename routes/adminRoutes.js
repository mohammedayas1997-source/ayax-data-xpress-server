const express = require("express");
const router = express.Router();

const { protect, authorize } = require("../middleware/authMiddleware");
const adminController = require("../controllers/adminController");
const dataPlanController = require("../controllers/dataPlanController");

// DEBUG (remove in production)
console.log("ADMIN KEYS:", Object.keys(adminController));
console.log("DATA PLAN:", dataPlanController?.getAllPlans);

// Middleware
router.use(protect);
router.use(authorize("admin", "superadmin"));

// Helper to prevent crash
const safe = (fn, name) => (req, res, next) => {
  if (!fn) {
    return res.status(500).json({
      success: false,
      message: `${name} controller is missing`,
    });
  }
  return fn(req, res, next);
};

// USERS
router.get("/users", safe(adminController.getAllUsers, "getAllUsers"));
router.get(
  "/supervisors",
  safe(adminController.getSupervisors, "getSupervisors"),
);
router.get("/agents", safe(adminController.getAgents, "getAgents"));

router.put(
  "/assign-target",
  safe(adminController.assignTarget, "assignTarget"),
);
router.patch(
  "/suspend-user/:id",
  safe(adminController.suspendUser, "suspendUser"),
);
router.patch(
  "/update-role",
  safe(adminController.updateUserRole, "updateUserRole"),
);

// WALLET
router.patch(
  "/toggle-wallet-status",
  safe(adminController.toggleWalletStatus, "toggleWalletStatus"),
);
router.post("/debit-user", safe(adminController.debitUser, "debitUser"));

// REFUNDS
router.get(
  "/pending-refunds",
  safe(adminController.getPendingRefunds, "getPendingRefunds"),
);
router.post(
  "/approve-refund/:id",
  safe(adminController.approveRefund, "approveRefund"),
);

// LOGS
router.get(
  "/activities",
  safe(adminController.getSupportActivities, "getSupportActivities"),
);
router.get(
  "/track-transaction/:transactionId",
  safe(adminController.trackTransaction, "trackTransaction"),
);

// SUPPORT
router.post(
  "/request-admin-fix",
  safe(adminController.requestAdminFix, "requestAdminFix"),
);
router.get(
  "/all-reports",
  safe(adminController.getSupportRequests, "getSupportRequests"),
);
router.patch(
  "/handle-report",
  safe(adminController.handleSupportRequest, "handleSupportRequest"),
);

// SUPERVISOR
router.post(
  "/create-supervisor",
  safe(adminController.createSupervisor, "createSupervisor"),
);

// NIMC
router.get(
  "/nimc-requests",
  safe(adminController.getAllNIMCRequests, "getAllNIMCRequests"),
);
router.patch(
  "/nimc-processing/:id",
  safe(adminController.updateToProcessing, "updateToProcessing"),
);
router.patch(
  "/approve-nimc/:id",
  safe(adminController.approveRequest, "approveRequest"),
);

// BVN
router.get(
  "/bvn-requests",
  safe(adminController.getAllBVNRequests, "getAllBVNRequests"),
);
router.patch(
  "/bvn-processing/:id",
  safe(adminController.updateBVNStatus, "updateBVNStatus"),
);
router.patch(
  "/approve-bvn/:id",
  safe(adminController.approveBVNRequest, "approveBVNRequest"),
);

// DATA PLANS
router.get("/data-plans", safe(dataPlanController?.getAllPlans, "getAllPlans"));

module.exports = router;
