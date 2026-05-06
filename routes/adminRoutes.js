const express = require("express");
const router = express.Router();

// 1. Middlewares
const { protect, authorize } = require("../middleware/authMiddleware");

// 2. Controllers
// Duk ayyukan yanzu suna cikin adminController guda daya
const adminController = require("../controllers/adminController");
const dataPlanController = require("../controllers/dataPlanController");
const notificationController = require("../controllers/notificationController");

// --- ADMIN PROTECTION ---
router.use(protect);
router.use(authorize("admin", "superadmin"));

// --- 3. USER MANAGEMENT ---
router.get("/users", adminController.getAllUsers);
router.get("/supervisors", adminController.getSupervisors);
router.get("/agents", adminController.getAgents);
router.put("/assign-target", adminController.assignTarget);
router.patch("/suspend-user/:id", adminController.suspendUser);
router.patch("/update-role", adminController.updateUserRole);

// --- 4. REFUND MANAGEMENT ---
router.get("/pending-refunds", adminController.getPendingRefunds);
router.post("/approve-refund/:id", adminController.approveRefund);

// --- 5. ACTIVITY LOGS ---
router.get("/activities", adminController.getSupportActivities);

// --- 6. NIMC MANAGEMENT ROUTES ---
// Wadannan yanzu suna kiran adminController kai tsaye
router.get("/nimc-requests", adminController.getAllNIMCRequests);
router.patch("/nimc-processing/:id", adminController.updateToProcessing);
router.patch("/approve-nimc/:id", adminController.approveRequest);

// --- 7. BVN MANAGEMENT ROUTES ---
// Wadannan ma yanzu suna kiran adminController kai tsaye
router.get("/bvn-requests", adminController.getAllBVNRequests);
router.patch("/bvn-processing/:id", adminController.updateBVNStatus);
router.patch("/approve-bvn/:id", adminController.approveBVNRequest);

// --- 8. DATA PLANS & NOTIFICATIONS ---
// Idan kana amfani da wadannan, su ma ka tabbatar endpoints dinsu suna nan
// router.get("/data-plans", dataPlanController.getAllPlans);

module.exports = router;
