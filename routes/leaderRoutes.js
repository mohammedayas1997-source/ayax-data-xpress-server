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

// Authentication middleware
router.use(protect);

// Izini ga ma'aikata
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

// Telemetry & Data Streams
router.get("/dashboard", getLeaderDashboard);
router.get("/agents-stream", getAgentsStream);
router.get("/live-audit-stream", getLiveAuditStream);
router.get("/agents", getAllAgents);

// Actions
router.post("/create-supervisor", createNewSupervisor);
router.post("/assign-target", assignSupervisorTarget);
router.post("/assign-agent", assignAgentToSupervisor);

// Status Toggles
router.patch("/toggle-status/:id", toggleSupervisorStatus);
router.patch("/toggle-supervisor/:supervisorId", toggleSupervisorStatus);

// Reports
router.get("/download-full-report", downloadSupervisorReport);
router.get("/report/:supervisorId", downloadSupervisorReport);

module.exports = router;