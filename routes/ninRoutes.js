const express = require("express");
const router = express.Router();
const { verifyTransactionPin } = require("../middleware/verifyPin");

// 1. Dynamic Authentication Middleware Loader
let authMiddleware;
try {
  authMiddleware = require("../middleware/authMiddleware");
} catch (e) {
  authMiddleware = require("../middleware/auth");
}

const protect = authMiddleware.protect || authMiddleware.verifyToken || authMiddleware;
const authorize = authMiddleware.authorize || authMiddleware.restrictTo || ((...roles) => (req, res, next) => next());

// 2. Controller Import (Supports multiple naming conventions)
let ninController;
try {
  ninController = require("../controllers/validationController");
} catch (e) {
  ninController = require("../controllers/ninController") || {};
}

// Safe Route Handler Helper
const safe = (fn, name) => {
  if (typeof fn === "function") return fn;
  return (req, res) => {
    return res.status(501).json({
      success: false,
      status: "failed",
      message: `NIN Validation controller handler '${name}' is not implemented yet.`,
    });
  };
};

// ==========================================
// 1. USER VALIDATION ROUTES
// ==========================================
// Submit new validation request (Tare da PIN Check)
router.post(
  "/validate",
  protect,
  verifyTransactionPin,
  safe(ninController.submitValidation || ninController.validateNIN, "submitValidation")
);

router.post(
  "/submit",
  protect,
  verifyTransactionPin,
  safe(ninController.submitValidation || ninController.validateNIN, "submitValidation")
);

router.put(
  "/validate",
  protect,
  verifyTransactionPin,
  safe(ninController.submitValidation || ninController.validateNIN, "submitValidation")
);

// User validation history
router.get(
  "/my-requests",
  protect,
  safe(ninController.getMyValidationRequests || ninController.getUserValidations, "getMyValidationRequests")
);

router.get(
  "/history",
  protect,
  safe(ninController.getMyValidationRequests || ninController.getUserValidations, "getMyValidationRequests")
);

// ==========================================
// 2. ADMIN / SUPERADMIN MANAGEMENT ROUTES
// ==========================================
// Fetch all validation requests
router.get(
  "/admin/all-requests",
  protect,
  authorize("admin", "superadmin"),
  safe(ninController.getAllValidationRequests || ninController.getAdminValidations, "getAllValidationRequests")
);

router.get(
  "/admin/all",
  protect,
  authorize("admin", "superadmin"),
  safe(ninController.getAllValidationRequests || ninController.getAdminValidations, "getAllValidationRequests")
);

// Approve / Complete validation
router.patch(
  "/admin/approve/:id",
  protect,
  authorize("admin", "superadmin"),
  safe(ninController.approveValidation || ninController.approveRequest, "approveValidation")
);

router.put(
  "/admin/approve/:id",
  protect,
  authorize("admin", "superadmin"),
  safe(ninController.approveValidation || ninController.approveRequest, "approveValidation")
);

// Reject validation with auto-refund
router.patch(
  "/admin/reject/:id",
  protect,
  authorize("admin", "superadmin"),
  safe(ninController.rejectValidation || ninController.rejectRequest, "rejectValidation")
);

module.exports = router;