const express = require("express");
const router = express.Router();
const {
  getAgentPerformance,
  getAgentSalesHistory,
  getMySupervisor,
  createAgent,
  getAgents,
  recordSale,
} = require("../controllers/agentController");

const { protect, authorize } = require("../middleware/authMiddleware");

// 1. KARE HANYOYI DA AUTHENTICATION
router.use(protect);

// 2. AGENT PERFORMANCE & QUOTA TELEMETRY (Endpoints guda biyu don tallafawa kowanne kira)
router.get(
  "/performance",
  authorize("agent", "supervisor", "field_supervisor", "state_manager", "leader", "national_sales_director", "admin", "superadmin"),
  getAgentPerformance
);
router.get(
  "/my-performance",
  authorize("agent", "supervisor", "field_supervisor", "state_manager", "leader", "national_sales_director", "admin", "superadmin"),
  getAgentPerformance
);

// 3. SALES & TRANSACTIONS HISTORY
router.get(
  "/sales-history",
  authorize("agent", "supervisor", "field_supervisor", "state_manager", "leader", "admin", "superadmin"),
  getAgentSalesHistory
);

// 4. ASSIGNED SUPERVISOR INFO
router.get(
  "/my-supervisor",
  authorize("agent", "supervisor", "field_supervisor", "admin", "superadmin"),
  getMySupervisor
);

// 5. RECORD NEW SALE
router.post(
  "/record-sale",
  authorize("agent", "supervisor", "admin", "superadmin"),
  recordSale
);

// 6. CREATE / REGISTER AGENT (Field Supervisors, State Managers, da Admins)
router.post(
  "/create",
  authorize("agent", "supervisor", "field_supervisor", "state_manager", "leader", "national_sales_director", "admin", "superadmin"),
  createAgent
);

// 7. GET AGENTS DIRECTORY
router.get(
  "/all",
  authorize("supervisor", "field_supervisor", "state_manager", "leader", "national_sales_director", "admin", "superadmin"),
  getAgents
);
router.get(
  "/",
  authorize("supervisor", "field_supervisor", "state_manager", "leader", "national_sales_director", "admin", "superadmin"),
  getAgents
);

module.exports = router;