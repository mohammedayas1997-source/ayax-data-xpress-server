const express = require("express");
const router = express.Router();

// 1. Middlewares
const { protect, authorize } = require("../middleware/authMiddleware");

// 2. Controllers
const adminController = require("../controllers/adminController");
// const dataPlanController = require("../controllers/dataPlanController");
// const notificationController = require("../controllers/notificationController");

// --- ADMIN PROTECTION ---
// Duk wani route da yake kasa da wannan layin, dole sai admin ko superadmin ya shiga
router.use(protect);
router.use(authorize("admin", "superadmin"));

// --- 3. USER MANAGEMENT ---
router.get("/users", adminController.getAllUsers);
router.get("/supervisors", adminController.getSupervisors);
router.get("/agents", adminController.getAgents);
router.put("/assign-target", adminController.assignTarget);
router.patch("/suspend-user/:id", adminController.suspendUser);
router.patch("/update-role", adminController.updateUserRole);

// --- NEW ADMIN POWERS ---
router.patch("/toggle-wallet-status", adminController.toggleWalletStatus);
router.post("/debit-user", adminController.debitUser);

// --- 4. REFUND MANAGEMENT ---
router.get("/pending-refunds", adminController.getPendingRefunds);
router.post("/approve-refund/:id", adminController.approveRefund);

// --- 5. ACTIVITY LOGS & SUPPORT ---
router.get("/activities", adminController.getSupportActivities);

// Binciken kudi (Track Transaction)
router.get(
  "/track-transaction/:transactionId",
  adminController.trackTransaction,
);

// Tura wa Admin bukatar gyara (Request Fix)
router.post("/request-admin-fix", adminController.requestAdminFix);

// Ganin dukkan rahotanni (Support Reports)
router.get("/all-reports", adminController.getSupportRequests);

// Matakin Admin akan rahoton koke (Handle Report)
router.patch("/handle-report", adminController.handleSupportRequest);

// --- 6. NIMC MANAGEMENT ROUTES ---
router.get("/nimc-requests", adminController.getAllNIMCRequests);
router.patch("/nimc-processing/:id", adminController.updateToProcessing);
router.patch("/approve-nimc/:id", adminController.approveRequest);

// --- 7. BVN MANAGEMENT ROUTES ---
router.get("/bvn-requests", adminController.getAllBVNRequests);
router.patch("/bvn-processing/:id", adminController.updateBVNStatus);
router.patch("/approve-bvn/:id", adminController.approveBVNRequest);

// --- 8. DATA PLANS & NOTIFICATIONS (Optional/Disabled) ---
router.get("/data-plans", dataPlanController.getAllPlans);

module.exports = router;
