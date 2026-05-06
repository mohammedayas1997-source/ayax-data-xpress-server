const express = require("express");
const router = express.Router();
const {
  getMyAgents,
  getAgentSalesSummary,
  assignTargetToAgent,
} = require("../controllers/supervisorController");

// Mun yi amfani da daidaitaccen middleware dinmu
const { protect, authorize } = require("../middleware/authMiddleware");

// --- SUPERVISOR ROUTES ---

// Duk wani route a nan, sai Supervisor ko Admin kawai
router.use(protect);
router.use(authorize("supervisor", "admin"));

// 1. Ganin jerin dukkan Agents da ke karkashinsa
router.get("/my-agents", getMyAgents);

// 2. Ganin yadda kowane Agent yake kokari (Sales summary)
router.get("/agent-performance/:agentId", getAgentSalesSummary);

// 3. Ba Agent takamaiman buri (Target) na wata
router.put("/assign-target/:agentId", assignTargetToAgent);

module.exports = router;
