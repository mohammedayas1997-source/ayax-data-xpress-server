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

// 1. KARE DUKKAN HANYOYI DA AUTHENTICATION & ROLE-BASED ACCESS CONTROL (RBAC)
router.use(protect);
router.use(
  authorize(
    "national_sales_director",
    "super_leader",
    "superadmin",
    "admin"
  )
);

// 2. NATIONAL DASHBOARD & TELEMETRY
router.get("/dashboard", getSuperLeaderDashboard);

// 3. TARGET ALLOCATION (SINGLE & BULK NATIONWIDE QUOTAS)
router.post("/assign-target", assignStateLeaderTarget);

// 4. EXECUTIVE RECRUITMENT (APPOINT STATE MANAGER)
router.post("/appoint-leader", appointStateLeader);

// 5. OPERATIONAL ACTIONS & AUDIT
router.patch("/toggle-status/:staffId", toggleStaffSuspension);
router.patch("/toggle-status", toggleStaffSuspension); // Fallback idan an turo ta req.body
router.get("/download-report", downloadNationalReport);

module.exports = router;