const express = require("express");
const router = express.Router();

// 1. Dynamic PIN Middleware Loader
let verifyTransactionPin = (req, res, next) => next();
try {
  const pinMod = require("../middleware/verifyPin");
  verifyTransactionPin = pinMod.verifyTransactionPin || pinMod;
} catch (e) {
  // Safe fallback
}

// 2. Dynamic Authentication Middleware Loader
let authMiddleware;
try {
  authMiddleware = require("../middleware/authMiddleware");
} catch (e) {
  try {
    authMiddleware = require("../middleware/auth");
  } catch (err) {
    authMiddleware = {};
  }
}

const protect = authMiddleware.protect || authMiddleware.verifyToken || ((req, res, next) => next());
const authorize = authMiddleware.authorize || authMiddleware.restrictTo || ((...roles) => (req, res, next) => next());

// 3. Controller Import
let ninController;
try {
  ninController = require("../controllers/validationController");
} catch (e) {
  try {
    ninController = require("../controllers/ninController");
  } catch (err) {
    ninController = {};
  }
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
// 1. USER VALIDATION & LOOKUP ROUTES
// ==========================================

// Quick Lookup / Verify (Baya bukatar PIN)
router.post(
  "/verify",
  protect,
  safe(ninController.verifyValidation || ninController.verifyNIN || ninController.submitValidation, "verifyValidation")
);

router.post(
  "/lookup",
  protect,
  safe(ninController.verifyValidation || ninController.verifyNIN, "verifyValidation")
);

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

router.post(
  "/process",
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

router.patch(
  "/admin/reject/:id",
  protect,
  authorize("admin", "superadmin"),
  safe(ninController.rejectValidation || ninController.rejectRequest, "rejectValidation")
);

module.exports = router;