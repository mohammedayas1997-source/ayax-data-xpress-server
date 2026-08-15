const express = require("express");
const router = express.Router();
const {
  getAgentPerformance,
  getAgentSalesHistory,
  getMySupervisor,
  createAgent,
  getAgents,
} = require("../controllers/agentController");

const { protect, authorize } = require("../middleware/authMiddleware");

// Duk route dake kasa yana bukatar authentication
router.use(protect);

// Routes na musamman ga Agents
router.get("/my-performance", authorize("agent"), getAgentPerformance);
router.get("/sales-history", authorize("agent"), getAgentSalesHistory);
router.get("/my-supervisor", authorize("agent"), getMySupervisor);

// Routes na kirkiro ko duba agents (yawanci Supervisors ko Admins ne ke yin su, ko kuma Agent din da yake da izini)
router.post("/create", authorize("agent", "supervisor", "admin", "superadmin"), createAgent);
router.get("/all", authorize("agent", "supervisor", "admin", "superadmin"), getAgents);

module.exports = router;