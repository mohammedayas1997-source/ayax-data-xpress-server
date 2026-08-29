const express = require("express");
const router = express.Router();

const leaderController = require("../controllers/leaderController");
const { protect } = require("../middleware/authMiddleware");

// Helper don kiyaye undefined handler errors
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
// 1. DASHBOARDS & TARGET TELEMETRY
// ==========================================
router.get("/dashboard", safeLeader("getSuperLeaderDashboard"));
router.get("/super-dashboard", safeLeader("getSuperLeaderDashboard"));
router.get("/my-state-target", safeLeader("getMyStateTarget"));

// ==========================================
// 2. LIVE FIELD STREAMS (AGENTS & AUDIT LOGS)
// ==========================================
router.get("/agents-stream", safeLeader("getAgentsStream"));
router.get("/live-audit-stream", safeLeader("getLiveAuditStream"));

// ==========================================
// 3. TARGET DEPLOYMENT (NSD & STATE MANAGER)
// ==========================================
router.post("/deploy-targets", safeLeader("assignStateLeaderTarget"));
router.post("/assign-target", safeLeader("assignStateLeaderTarget"));

// ==========================================
// 4. APPOINT & ENROLL SUPERVISORS
// ==========================================
router.post("/create-supervisor", safeLeader("appointStateLeader"));
router.post("/appoint-supervisor", safeLeader("appointStateLeader"));
router.post("/appoint-manager", safeLeader("appointStateLeader"));
router.patch("/toggle-status/:staffId", safeLeader("toggleStaffSuspension"));
router.patch("/toggle-status", safeLeader("toggleStaffSuspension"));

// ==========================================
// 5. AUDIT REPORTS (CSV)
// ==========================================
router.get("/download-full-report", safeLeader("downloadNationalReport"));
router.get("/download-report", safeLeader("downloadNationalReport"));

module.exports = router;