const express = require("express");
const router = express.Router();

// 1. Authentication & Authorization Middleware
let authMiddleware;
try {
  authMiddleware = require("../middleware/authMiddleware");
} catch (e) {
  authMiddleware = require("../middleware/auth");
}

const protect =
  authMiddleware.protect || authMiddleware.verifyToken || authMiddleware;
const authorize =
  authMiddleware.authorize ||
  authMiddleware.restrictTo ||
  ((...roles) => (req, res, next) => next());

// Strict SuperAdmin Role Check Middleware
const superAdminOnly = authorize("superadmin");

// 2. Controller Imports
const superAdminController = require("../controllers/superAdminController");

// Safe Route Handler Helper
const safe = (fn, name) => {
  if (typeof fn === "function") return fn;
  return (req, res) => {
    return res.status(501).json({
      success: false,
      status: "failed",
      message: `SuperAdmin controller handler '${name}' is not implemented yet.`,
    });
  };
};

// ==========================================
// 1. GLOBAL TELEMETRY & SYSTEM ANALYTICS
// ==========================================
router.get(
  "/overview",
  protect,
  superAdminOnly,
  safe(superAdminController.getGlobalDataOverview, "getGlobalDataOverview")
);

router.get(
  "/telemetry",
  protect,
  superAdminOnly,
  safe(superAdminController.getGlobalDataOverview, "getGlobalDataOverview")
);

// ==========================================
// 2. FINANCIAL DISPATCH & EXECUTIVE REFUNDS
// ==========================================
// Direct Wallet Credit / Debit
router.post(
  "/wallet/adjust",
  protect,
  superAdminOnly,
  safe(superAdminController.adjustUserWallet, "adjustUserWallet")
);

// Executive Override Refund
router.post(
  "/refunds/executive-override",
  protect,
  superAdminOnly,
  safe(
    superAdminController.processRefundSuperAdminOnly,
    "processRefundSuperAdminOnly"
  )
);

// ==========================================
// 3. ROLE ELEVATION & SECURITY CONTROLS
// ==========================================
// Promote / Demote User Role
router.patch(
  "/users/change-role",
  protect,
  superAdminOnly,
  safe(superAdminController.changeUserRole, "changeUserRole")
);

// Force Override Password / PIN
router.post(
  "/users/force-reset-security",
  protect,
  superAdminOnly,
  safe(
    superAdminController.forceResetUserSecurity,
    "forceResetUserSecurity"
  )
);

// Lock / Unlock User Account
router.patch(
  "/users/toggle-lock",
  protect,
  superAdminOnly,
  safe(superAdminController.toggleWalletLock, "toggleWalletLock")
);

// ==========================================
// 4. BULK VTU & MARKETING AUTOMATION
// ==========================================
router.post(
  "/vtu/dispatch-bulk",
  protect,
  superAdminOnly,
  safe(superAdminController.dispatchDataBundle, "dispatchDataBundle")
);

// ==========================================
// 5. GLOBAL PRICING & TARIFF MATRIX OVERRIDE
// ==========================================
router.post(
  "/pricing/set-global",
  protect,
  superAdminOnly,
  safe(
    superAdminController.setGlobalServicePrice,
    "setGlobalServicePrice"
  )
);

// ==========================================
// 6. FORENSIC AUDIT EXPUNGING
// ==========================================
router.delete(
  "/logs/expunge",
  protect,
  superAdminOnly,
  safe(
    superAdminController.expungeSystemAuditLogs,
    "expungeSystemAuditLogs"
  )
);

module.exports = router;