const express = require("express");
const router = express.Router();

const { protect, authorize } = require("../middleware/authMiddleware");

// Controller functions for NIMC management
const {
  submitNIMCRequest,
  getAllNIMCRequests,
  updateToProcessing,
  approveRequest,
  getMyNIMCRequests,
} = require("../controllers/nimcController");

// --- USER ROUTES ---
// Hanyar da user zai bi ya tura sabon request (Tallafawa POST da PUT)
router.post("/submit", protect, submitNIMCRequest);
router.put("/submit", protect, submitNIMCRequest);

// Hanyar da user zai duba tarihin (history) requests dinsa
router.get("/my-requests", protect, getMyNIMCRequests);

// --- ADMIN / SUPERADMIN ROUTES ---
// Hanyar da Admin zai duba dukkan requests da aka turo
router.get("/admin/requests", protect, authorize("admin", "superadmin"), getAllNIMCRequests);

// Hanyar da Admin zai saita request ya koma 'processing' (Tallafawa PATCH da PUT)
router.patch("/admin/processing/:id", protect, authorize("admin", "superadmin"), updateToProcessing);
router.put("/admin/processing/:id", protect, authorize("admin", "superadmin"), updateToProcessing);

// Hanyar da Admin zai kammala aiki (Approve) ba tare da loda hoto ba
router.patch("/admin/approve/:id", protect, authorize("admin", "superadmin"), approveRequest);
router.put("/admin/approve/:id", protect, authorize("admin", "superadmin"), approveRequest);

module.exports = router;