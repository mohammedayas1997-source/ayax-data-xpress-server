const express = require("express");
const router = express.Router();
const ninController = require("../controllers/ninController");

// 1. Middlewares na tsaro da tabbatar da izinin shiga
const { protect, authorize } = require("../middleware/authMiddleware");

// --- USER ROUTES ---
// Hanyar karbar sabon validation (tana bukatar mai amfani ya shiga)
router.post("/validate", protect, ninController.submitValidation);

// --- ADMIN ROUTES ---
// Hanyar da Admin zai gani dukkan requests (An mayar da logic din zuwa controller domin tsaftar code)
router.get(
  "/admin/all-requests",
  protect,
  authorize("admin", "superadmin"),
  ninController.getAllValidationRequests
);

module.exports = router;