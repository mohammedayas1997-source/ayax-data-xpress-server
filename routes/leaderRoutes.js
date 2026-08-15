const express = require("express");
const router = express.Router();
const {
  getLeaderDashboard,
  getAllAgents,
  createNewSupervisor,
  toggleSupervisorStatus,
  assignSupervisorTarget,
  assignAgentToSupervisor,
  downloadSupervisorReport,
} = require("../controllers/leaderController");

const { protect, authorize } = require("../middleware/authMiddleware");

// Duk route dake kasa yana bukatar mai amfani ya shiga (Authenticated)
router.use(protect);

// Izinin shiga an kara musu wadatar "superadmin" daidai da sauran bangarorin admin
router.use(authorize("leader", "admin", "superadmin"));

// Wadannan sunayen sun dace da "exports.sunanFunction" na Controller
router.get("/dashboard", getLeaderDashboard);
router.get("/agents", getAllAgents);
router.post("/create-supervisor", createNewSupervisor);
router.patch("/toggle-supervisor/:supervisorId", toggleSupervisorStatus);
router.post("/assign-target", assignSupervisorTarget);
router.post("/assign-agent", assignAgentToSupervisor);
router.get("/report/:supervisorId", downloadSupervisorReport);

module.exports = router;