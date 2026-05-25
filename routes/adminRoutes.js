const express = require("express");
const router = express.Router();

const { protect, authorize } = require("../middleware/authMiddleware");
const adminController = require("../controllers/adminController");
const dataPlanController = require("../controllers/dataPlanController");

console.log(Object.keys(adminController));
console.log("createSupervisor:", adminController.createSupervisor);

router.use(protect);
router.use(authorize("admin", "superadmin"));

// USERS
router.get("/users", adminController.getAllUsers);
router.get("/supervisors", adminController.getSupervisors);
router.get("/agents", adminController.getAgents);
router.put("/assign-target", adminController.assignTarget);
router.patch("/suspend-user/:id", adminController.suspendUser);
router.patch("/update-role", adminController.updateUserRole);

// WALLET / FINANCE
router.patch("/toggle-wallet-status", adminController.toggleWalletStatus);
router.post("/debit-user", adminController.debitUser);

// REFUNDS
router.get("/pending-refunds", adminController.getPendingRefunds);
router.post("/approve-refund/:id", adminController.approveRefund);

// LOGS
router.get("/activities", adminController.getSupportActivities);
router.get(
  "/track-transaction/:transactionId",
  adminController.trackTransaction,
);

// SUPPORT
router.post("/request-admin-fix", adminController.requestAdminFix);
router.get("/all-reports", adminController.getSupportRequests);
router.patch("/handle-report", adminController.handleSupportRequest);

// SUPERVISOR
router.post("/create-supervisor", adminController.createSupervisor);

// NIMC
router.get("/nimc-requests", adminController.getAllNIMCRequests);
router.patch("/nimc-processing/:id", adminController.updateToProcessing);
router.patch("/approve-nimc/:id", adminController.approveRequest);

// BVN
router.get("/bvn-requests", adminController.getAllBVNRequests);
router.patch("/bvn-processing/:id", adminController.updateBVNStatus);
router.patch("/approve-bvn/:id", adminController.approveBVNRequest);

// DATA PLANS
router.get("/data-plans", dataPlanController.getAllPlans);

module.exports = router;
