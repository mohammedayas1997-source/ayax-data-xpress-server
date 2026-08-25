const express = require("express");
const router = express.Router();
const {
  getSuperLeaderDashboard,
  assignStateLeaderTarget,
  appointStateLeader,
  toggleStaffSuspension,
  downloadNationalReport,
} = require("../controllers/superLeaderController");

const { protect, authorize } = require("../middleware/authMiddleware");

router.use(protect);
router.use(authorize("national_sales_director", "super_leader", "superadmin", "admin"));

// Dashboard & State Management
router.get("/dashboard", getSuperLeaderDashboard);
router.post("/assign-target", assignStateLeaderTarget);
router.post("/appoint-leader", appointStateLeader);

// Suspension & Actions
router.patch("/toggle-status/:staffId", toggleStaffSuspension);
router.get("/download-report", downloadNationalReport);

module.exports = router;