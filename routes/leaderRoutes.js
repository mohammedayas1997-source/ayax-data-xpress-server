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

// Duk routes na ƙasa suna buƙatar ingantaccen login token
router.use(protect);

// Bayar da izini ga Leader, Admin, da Superadmin
// Bayar da izini ga State Managers, NSD, Leaders, da Admins
router.use(authorize("state_manager", "leader", "national_sales_director", "super_leader", "admin", "superadmin"));

// --- DASHBOARD & LIVE TELEMETRY STREAMS ---
router.get("/dashboard", getLeaderDashboard);
router.get("/agents-stream", getAgentsStream);
router.get("/live-audit-stream", getLiveAuditStream);
router.get("/agents", getAllAgents);

// --- FIELD MANAGEMENT & INTERVENTIONS ---
router.post("/create-supervisor", createNewSupervisor);
router.post("/assign-target", assignSupervisorTarget);
router.post("/assign-agent", assignAgentToSupervisor);

// Status Toggles (yana ɗaukar duka salon routes biyu don daidaito)
router.patch("/toggle-status/:id", toggleSupervisorStatus);
router.patch("/toggle-supervisor/:supervisorId", toggleSupervisorStatus);

// Reports & Analytics Downloads
router.get("/download-full-report", downloadSupervisorReport);
router.get("/report/:supervisorId", downloadSupervisorReport);

module.exports = router;