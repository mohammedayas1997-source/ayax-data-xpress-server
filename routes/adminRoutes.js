const express = require("express");
const router = express.Router();

const { protect, authorize } = require("../middleware/authMiddleware");
const adminController = require("../controllers/adminController") || {};
const dataPlanController = require("../controllers/dataPlanController") || {};

const safe = (fn, name) => {
  if (typeof fn === "function") return fn;
  return (req, res) => {
    res.status(501).json({
      success: false,
      message: `Controller function '${name}' is not implemented yet.`,
    });
  };
};

// Kariya ga dukkan hanyoyin Admin da Superadmin
if (typeof protect === "function") router.use(protect);
if (typeof authorize === "function") router.use(authorize("admin", "superadmin"));

// --- 1. DASHBOARD & TRANSACTIONS ---
router.get("/stats", safe(adminController.getDashboardStats, "getDashboardStats"));
router.get("/transactions", safe(adminController.getAllTransactions, "getAllTransactions"));

// --- 2. USER MANAGEMENT ---
router.get("/users", safe(adminController.getAllUsers, "getAllUsers"));
router.get("/supervisors", safe(adminController.getSupervisors, "getSupervisors"));
router.get("/agents", safe(adminController.getAgents, "getAgents"));
router.put("/assign-target", safe(adminController.assignTarget, "assignTarget"));
router.patch("/suspend-user/:id", safe(adminController.suspendUser, "suspendUser"));

// --- 3. REFUNDS ---
router.get("/pending-refunds", safe(adminController.getPendingRefunds, "getPendingRefunds"));
router.post("/approve-refund/:id", safe(adminController.approveRefund, "approveRefund"));

// --- 4. ACTIVITIES & SUPPORT ---
router.get("/activities", safe(adminController.getSupportActivities, "getSupportActivities"));

// --- 5. NIMC & BVN REQUESTS ---
router.get("/nimc-requests", safe(adminController.getAllNIMCRequests, "getAllNIMCRequests"));
router.patch("/approve-nimc/:id", safe(adminController.approveRequest, "approveRequest"));
router.get("/bvn-requests", safe(adminController.getAllBVNRequests, "getAllBVNRequests"));
router.patch("/approve-bvn/:id", safe(adminController.approveBVNRequest, "approveBVNRequest"));

// --- 6. DATA PLANS ---
router.get("/plans", safe(dataPlanController.getActivePlans || dataPlanController.getPlans, "getActivePlans"));
router.post("/set-plan", safe(dataPlanController.createPlan || dataPlanController.setPlanPrice, "createPlan"));
router.put("/plans/:id", safe(dataPlanController.updatePlan, "updatePlan"));
router.delete("/plans/:id", safe(dataPlanController.deletePlan, "deletePlan"));

module.exports = router;