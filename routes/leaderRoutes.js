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
} = require("../controllers/leaderController"); // Tabbatar sunan file din ya dace

const { protect, authorize } = require("../middleware/authMiddleware");

router.use(protect);
router.use(authorize("leader", "admin"));

// Wadannan sunayen dole su dace da "exports.sunanFunction" na Controller
router.get("/dashboard", getLeaderDashboard);
router.get("/agents", getAllAgents);
router.post("/create-supervisor", createNewSupervisor);
router.patch("/toggle-supervisor/:supervisorId", toggleSupervisorStatus);
router.post("/assign-target", assignSupervisorTarget);
router.post("/assign-agent", assignAgentToSupervisor);
router.get("/report/:supervisorId", downloadSupervisorReport);

module.exports = router;
