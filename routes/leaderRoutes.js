const express = require("express");
const router = express.Router();
const {
  getLeaderDashboard,
  getAgentsStream,
  getLiveAuditStream,
  getAllAgents,
  createNewSupervisor,
  toggleSupervisorStatus,
  assignSupervisorTarget,
  assignAgentToSupervisor,
  downloadSupervisorReport,
} = require("../controllers/leaderController");

const { protect, authorize } = require("../middleware/authMiddleware");

// 1. KARE HANYOYI DA AUTHENTICATION & ROLE-BASED ACCESS CONTROL (RBAC)
router.use(protect);

router.use(
  authorize(
    "state_manager",
    "leader",
    "national_sales_director",
    "super_leader",
    "admin",
    "superadmin"
  )
);

// 2. TELEMETRY & DATA STREAMS
router.get("/dashboard", getLeaderDashboard);
router.get("/agents-stream", getAgentsStream);
router.get("/live-audit-stream", getLiveAuditStream);
router.get("/agents", getAllAgents);
router.get("/all-agents", getAgentsStream); // Fallback don ManageAgentsScreen

// 3. OPERATIONAL ACTIONS (TARGETS & AGENT REASSIGNMENT)
router.post("/create-supervisor", createNewSupervisor);
router.post("/assign-target", assignSupervisorTarget);
router.post("/assign-agent", assignAgentToSupervisor);

// 4. STATUS TOGGLES (SUSPEND / UNSUSPEND SUPERVISOR)
router.patch("/toggle-status/:supervisorId", toggleSupervisorStatus);
router.patch("/toggle-status/:id", toggleSupervisorStatus);
router.patch("/toggle-supervisor/:supervisorId", toggleSupervisorStatus);
router.patch("/toggle-status", toggleSupervisorStatus); // Fallback idan an turo id ta req.body

// 5. REPORTS & EXPORTS
router.get("/download-full-report", downloadSupervisorReport);
router.get("/download-report", downloadSupervisorReport);
router.get("/report/:supervisorId", downloadSupervisorReport);

module.exports = router;