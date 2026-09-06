const express = require("express");
const router = express.Router();

const supervisorController = require("../controllers/supervisorController");
const { protect, authorize } = require("../middleware/authMiddleware");

// Helper don kiyaye undefined errors idan aikin bai riga ya wanzu ba
const safeSup = (handlerName) => {
  return (req, res, next) => {
    if (typeof supervisorController[handlerName] === "function") {
      return supervisorController[handlerName](req, res, next);
    }
    return res.status(501).json({
      success: false,
      message: `Supervisor handler '${handlerName}' not implemented yet.`,
    });
  };
};

// 1. KARE HANYOYI DA AUTHENTICATION & ROLE-BASED ACCESS CONTROL (RBAC)
router.use(protect);

// Sassauta authorize don kar ya toshe Supervisor mai alamar role daban-daban
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

// 2. DASHBOARD, PROFILE, MY TARGET & LOGS (REAL-TIME TELEMETRY)
router.get("/dashboard", safeSup("getSupervisorDashboard"));
router.get("/profile", safeSup("getSupervisorProfile"));
router.get("/my-target", safeSup("getMyTarget"));
router.get("/activity-logs", safeSup("getActivityLogs"));

// 3. LGA AGENTS DIRECTORY (DUBA AGENTS A RAYE)
router.get("/my-agents", safeSup("getMyAgents"));
router.get("/agents", safeSup("getMyAgents")); // Fallback

// 4. AGENT SIGNUP / ENROLLMENT (CONNECTS TO OFFICIAL REGISTRATION)
router.post("/create-agent", safeSup("createAgent"));
router.post("/enroll-agent", safeSup("createAgent"));

router.post(
  "/supervisors/transfer-all-agents",
  supervisorController.transferAllAgentsToNewSupervisor
);

router.post(
  "/supervisors/transfer-single-agent",
  supervisorController.transferSingleAgent
);

// 5. AGENT REAL-TIME SALES, FLOAT & PERFORMANCE MONITORING
router.get("/agent-performance/:agentId", safeSup("getAgentSalesSummary"));
router.get("/agent-sales/:agentId", safeSup("getAgentSalesSummary"));

module.exports = router;