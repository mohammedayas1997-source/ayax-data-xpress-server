const express = require("express");
const router = express.Router();
const {
  getSupervisorProfile,
  getMyAgents,
  getAgentSalesSummary,
  assignTargetToAgent,
} = require("../controllers/supervisorController");

const { protect, authorize } = require("../middleware/authMiddleware");

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

// 2. PROFILE & TARGETS TELEMETRY
router.get("/profile", getSupervisorProfile);

// 3. LGA AGENTS DIRECTORY
router.get("/my-agents", getMyAgents);
router.get("/agents", getMyAgents); // Fallback

// 4. AGENT REAL-TIME SALES & PERFORMANCE
router.get("/agent-performance/:agentId", getAgentSalesSummary);
router.get("/agent-sales/:agentId", getAgentSalesSummary);

// 5. AGENT TARGET ASSIGNMENT (DATA & AIRTIME)
router.patch("/assign-target/:agentId", assignTargetToAgent);
router.put("/assign-target/:agentId", assignTargetToAgent);
router.post("/assign-target/:agentId", assignTargetToAgent);

module.exports = router;