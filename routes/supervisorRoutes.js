const express = require("express");
const router = express.Router();

let supervisorController;
try {
  supervisorController = require("../controllers/supervisorController");
} catch (e) {
  supervisorController = require("../controllers/supervisor.controller");
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
const authorize =
  authMiddleware?.authorize ||
  authMiddleware?.restrictTo ||
  ((...roles) => (req, res, next) => next());

// Helper don kiyaye undefined errors
const safeSup = (handlerName) => {
  return (req, res, next) => {
    if (supervisorController && typeof supervisorController[handlerName] === "function") {
      return supervisorController[handlerName](req, res, next);
    }
    return res.status(501).json({
      success: false,
      message: `Supervisor handler '${handlerName}' not implemented yet.`,
    });
  };
};

// 1. Tsaron Login
router.use(protect);
router.use(
  authorize(
    "supervisor",
    "field_supervisor",
    "fs",
    "state_manager",
    "leader",
    "national_sales_director",
    "super_leader",
    "admin",
    "superadmin",
    "agent",
    "user"
  )
);

// 2. Dashboard, Profile, Targets & Logs
router.get("/dashboard", safeSup("getSupervisorDashboard"));
router.get("/profile", safeSup("getSupervisorProfile"));
router.get("/my-target", safeSup("getMyTarget"));
router.get("/activity-logs", safeSup("getActivityLogs"));

// 3. Agents Directory
router.get("/my-agents", safeSup("getMyAgents"));
router.get("/agents", safeSup("getMyAgents"));

// 4. Agent Signup & Transfers
router.post("/create-agent", safeSup("createAgent"));
router.post("/enroll-agent", safeSup("createAgent"));
router.post("/supervisors/transfer-all-agents", safeSup("transferAllAgentsToNewSupervisor"));
router.post("/supervisors/transfer-single-agent", safeSup("transferSingleAgent"));

// 5. Sales & Telemetry
router.get("/agent-performance/:agentId", safeSup("getAgentSalesSummary"));
router.get("/agent-sales/:agentId", safeSup("getAgentSalesSummary"));

module.exports = router;