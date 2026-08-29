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
router.use(
  authorize(
    "supervisor",
    "field_supervisor",
    "state_manager",
    "leader",
    "national_sales_director",
    "super_leader",
    "admin",
    "superadmin"
  )
);

// 2. DASHBOARD, PROFILE & TARGETS TELEMETRY
router.get("/dashboard", safeSup("getSupervisorDashboard"));
router.get("/profile", safeSup("getSupervisorProfile"));
router.get("/my-target", safeSup("getMyTarget"));
router.get("/activity-logs", safeSup("getActivityLogs"));

// 3. LGA AGENTS DIRECTORY
router.get("/my-agents", safeSup("getMyAgents"));
router.get("/agents", safeSup("getMyAgents")); // Fallback

// 4. CREATE / ENROLL RETAIL AGENTS
router.post("/create-agent", safeSup("createAgent"));
router.post("/enroll-agent", safeSup("createAgent"));

// 5. AGENT TARGET ASSIGNMENT (AUTO-SPLIT & DIRECT BODY/PARAMS)
router.post("/assign-agent-target", safeSup("assignAgentTarget"));
router.patch("/assign-target/:agentId", safeSup("assignTargetToAgent"));
router.put("/assign-target/:agentId", safeSup("assignTargetToAgent"));
router.post("/assign-target/:agentId", safeSup("assignTargetToAgent"));

// 6. AGENT REAL-TIME SALES & PERFORMANCE
router.get("/agent-performance/:agentId", safeSup("getAgentSalesSummary"));
router.get("/agent-sales/:agentId", safeSup("getAgentSalesSummary"));

module.exports = router;