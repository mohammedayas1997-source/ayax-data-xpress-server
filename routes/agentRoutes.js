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

router.use(protect);
router.use(authorize("agent"));

router.get("/my-performance", getAgentPerformance);
router.get("/sales-history", getAgentSalesHistory);
router.get("/my-supervisor", getMySupervisor);
router.post("/create", createAgent);
router.get("/all", getAgents);

module.exports = router;
