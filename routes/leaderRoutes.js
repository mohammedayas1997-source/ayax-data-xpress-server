const express = require("express");
const router = express.Router();

let leaderController;
try {
  leaderController = require("../controllers/leaderController");
} catch (e) {
  leaderController = require("../controllers/leader.controller");
}

let authMiddleware;
try {
  authMiddleware = require("../middleware/authMiddleware");
} catch (e) {
  authMiddleware = require("../middleware/auth");
}

const protect =
  authMiddleware?.protect || authMiddleware?.verifyToken || authMiddleware;
const authorize =
  authMiddleware?.authorize ||
  authMiddleware?.restrictTo ||
  ((...roles) => (req, res, next) => next());

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
router.use(
  authorize(
    "leader",
    "state_manager",
    "national_sales_director",
    "super_leader",
    "superadmin",
    "admin"
  )
);

// ==========================================
// 1. DASHBOARDS & TARGET TELEMETRY
// ==========================================
router.get("/dashboard", safeLeader("getSuperLeaderDashboard"));
router.get("/super-dashboard", safeLeader("getSuperLeaderDashboard"));
router.get("/my-state-target", safeLeader("getMyStateTarget"));

// ==========================================
// 2. SUPERVISORS LIST (Wanda ke goge 404 a Dashboard)
// ==========================================
router.get("/supervisors", safeLeader("getSupervisors"));
router.get("/all-supervisors", safeLeader("getSupervisors"));

// ==========================================
// 3. LIVE FIELD STREAMS (AGENTS & AUDIT LOGS)
// ==========================================
router.get("/agents", safeLeader("getAllAgents"));
router.get("/agents-stream", safeLeader("getAgentsStream"));
router.get("/live-audit-stream", safeLeader("getLiveAuditStream"));

// ==========================================
// 4. TARGET DEPLOYMENT (NSD & STATE MANAGER)
// ==========================================
router.post("/deploy-targets", safeLeader("assignStateLeaderTarget"));
router.post("/assign-target", safeLeader("assignStateLeaderTarget"));

// ==========================================
// 5. APPOINT & ENROLL SUPERVISORS
// ==========================================
router.post("/create-supervisor", safeLeader("appointStateLeader"));
router.post("/appoint-supervisor", safeLeader("appointStateLeader"));
router.post("/appoint-manager", safeLeader("appointStateLeader"));
router.patch("/toggle-status/:staffId", safeLeader("toggleSupervisorStatus"));
router.patch("/toggle-status", safeLeader("toggleSupervisorStatus"));

// ==========================================
// 6. AUDIT REPORTS (CSV)
// ==========================================
router.get("/download-full-report", safeLeader("downloadSupervisorReport"));
router.get("/download-report", safeLeader("downloadSupervisorReport"));

module.exports = router;