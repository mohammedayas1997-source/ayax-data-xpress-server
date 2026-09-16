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
  try {
    authMiddleware = require("../middleware/auth");
  } catch (err) {
    authMiddleware = null;
  }
}

const protect =
  authMiddleware?.protect || authMiddleware?.verifyToken || authMiddleware || ((req, res, next) => next());

// Safe Leader Action Invoker
const safeLeader = (handlerName, fallbackName = null) => {
  return (req, res, next) => {
    if (leaderController && typeof leaderController[handlerName] === "function") {
      return leaderController[handlerName](req, res, next);
    }
    if (fallbackName && leaderController && typeof leaderController[fallbackName] === "function") {
      return leaderController[fallbackName](req, res, next);
    }
    return res.status(501).json({
      success: false,
      message: `Leader handler '${handlerName}' is not implemented yet.`,
    });
  };
};

// Sanya Tsaron Login
router.use(protect);

// ==========================================
// 1. DASHBOARDS & TARGET TELEMETRY
// ==========================================
router.get("/dashboard", safeLeader("getSuperLeaderDashboard", "getLeaderDashboard"));
router.get("/super-dashboard", safeLeader("getSuperLeaderDashboard", "getLeaderDashboard"));
router.get("/my-state-target", safeLeader("getMyStateTarget"));

// ==========================================
// 2. SUPERVISORS LIST
// ==========================================
router.get("/supervisors", safeLeader("getSupervisors"));
router.get("/all-supervisors", safeLeader("getSupervisors"));

// ==========================================
// 3. LIVE FIELD STREAMS (AGENTS & AUDIT LOGS)
// ==========================================
router.get("/agents", safeLeader("getAllAgents", "getAgentsStream"));
router.get("/agents-stream", safeLeader("getAgentsStream"));
router.get("/live-audit-stream", safeLeader("getLiveAuditStream"));

// ==========================================
// 4. TARGET DEPLOYMENT
// ==========================================
router.post("/deploy-targets", safeLeader("assignStateLeaderTarget", "assignSupervisorTarget"));
router.post("/assign-target", safeLeader("assignStateLeaderTarget", "assignSupervisorTarget"));

// ==========================================
// 5. APPOINT & ENROLL SUPERVISORS (Tare da Fallback don kar ya gaza shiga Database)
// ==========================================
router.post("/create-supervisor", safeLeader("appointStateLeader", "createNewSupervisor"));
router.post("/appoint-supervisor", safeLeader("appointStateLeader", "createNewSupervisor"));
router.post("/appoint-manager", safeLeader("appointStateLeader", "createNewSupervisor"));
router.patch("/toggle-status/:staffId", safeLeader("toggleSupervisorStatus"));
router.patch("/toggle-status", safeLeader("toggleSupervisorStatus"));

// ==========================================
// 6. AUDIT REPORTS (CSV)
// ==========================================
router.get("/download-full-report", safeLeader("downloadSupervisorReport"));
router.get("/download-report", safeLeader("downloadSupervisorReport"));

module.exports = router;