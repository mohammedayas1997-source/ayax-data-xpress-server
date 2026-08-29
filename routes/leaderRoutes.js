const express = require("express");
const router = express.Router();

// 1. Shigo da Controllers da Middleware
const leaderController = require("../controllers/leaderController");
const { protect } = require("../middleware/authMiddleware");

// Helper don kiyaye kuskure idan controller bai riga ya samu ba
const safeLeader = (handlerName) => {
  return (req, res, next) => {
    if (typeof leaderController[handlerName] === "function") {
      return leaderController[handlerName](req, res, next);
    }
    return res.status(501).json({
      success: false,
      message: `Leader handler '${handlerName}' is not implemented yet.`,
    });
  };
};

// Sanya Tsaron Login ga dukkan routes
router.use(protect);

// ==========================================
// 1. NATIONAL / STATE OVERVIEW & DASHBOARD
// ==========================================
router.get("/dashboard", safeLeader("getSuperLeaderDashboard"));
router.get("/super-dashboard", safeLeader("getSuperLeaderDashboard"));
router.get("/my-state-target", safeLeader("getMyStateTarget"));

// ==========================================
// 2. TARGET DEPLOYMENT (NSD & STATE MANAGER)
// ==========================================
router.post("/deploy-targets", safeLeader("assignStateLeaderTarget"));
router.post("/assign-target", safeLeader("assignStateLeaderTarget"));

// ==========================================
// 3. SUPERVISORS & STAFF MANAGEMENT
// ==========================================
router.post("/create-supervisor", safeLeader("appointStateLeader"));
router.post("/appoint-manager", safeLeader("appointStateLeader"));
router.patch("/toggle-status/:staffId", safeLeader("toggleStaffSuspension"));
router.patch("/toggle-status", safeLeader("toggleStaffSuspension"));

// ==========================================
// 4. LIVE AUDIT & REPORTS
// ==========================================
router.get("/download-full-report", safeLeader("downloadNationalReport"));
router.get("/download-report", safeLeader("downloadNationalReport"));

module.exports = router;