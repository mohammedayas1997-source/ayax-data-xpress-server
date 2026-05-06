const express = require("express");
const router = express.Router();

const { protect, adminOnly } = require("../middleware/authMiddleware");

// Mun cire upload da multer tunda yanzu Direct Approval za ayi ba tare da hoto ba
const {
  submitNIMCRequest,
  getAllNIMCRequests,
  updateToProcessing,
  approveRequest, // Mun sauya sunan wannan daga approveAndUploadSlip
  getMyNIMCRequests,
} = require("../controllers/nimcController");

// --- USER ROUTES ---
// Hanyar da user zai bi ya tura sabon request
router.post("/submit", protect, submitNIMCRequest);

// Hanyar da user zai duba tarihin (history) requests dinsa
router.get("/my-requests", protect, getMyNIMCRequests);

// --- ADMIN ROUTES ---
// Hanyar da Admin zai duba dukkan requests da aka turo
router.get("/admin/requests", protect, adminOnly, getAllNIMCRequests);

// Hanyar da Admin zai saita request ya koma 'processing'
router.patch("/admin/processing/:id", protect, adminOnly, updateToProcessing);

// Hanyar da Admin zai kammala aiki (Approve) ba tare da loda hoto ba
// Mun canza zuwa .patch domin yana nufin update na status
router.patch("/admin/approve/:id", protect, adminOnly, approveRequest);

module.exports = router;
