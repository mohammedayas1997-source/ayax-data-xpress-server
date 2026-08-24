const express = require("express");
const router = express.Router();

// 1. Dynamic Authentication & Authorization Middleware Loader
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

// Apply Global SuperAdmin Protection
router.use(protect);
router.use(superAdminOnly);

// ==========================================
// 1. GLOBAL TELEMETRY & SYSTEM ANALYTICS
// ==========================================
router.get(
  "/overview",
  safe(superAdminController.getGlobalDataOverview, "getGlobalDataOverview")
);

router.get(
  "/telemetry",
  safe(superAdminController.getGlobalDataOverview, "getGlobalDataOverview")
);

router.get(
  "/stats",
  safe(superAdminController.getGlobalDataOverview, "getGlobalDataOverview")
);

// ==========================================
// 2. FINANCIAL DISPATCH & EXECUTIVE REFUNDS
// ==========================================
// Direct Wallet Credit / Debit
router.post(
  "/wallet/adjust",
  safe(superAdminController.adjustUserWallet, "adjustUserWallet")
);

router.post(
  "/adjust-wallet",
  safe(superAdminController.adjustUserWallet, "adjustUserWallet")
);

// Executive Override Refund
router.post(
  "/refunds/executive-override",
  safe(
    superAdminController.processRefundSuperAdminOnly,
    "processRefundSuperAdminOnly"
  )
);

router.post(
  "/process-refund",
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
  safe(superAdminController.changeUserRole, "changeUserRole")
);

router.post(
  "/change-user-role",
  safe(superAdminController.changeUserRole, "changeUserRole")
);

// Force Override Password / PIN
router.post(
  "/users/force-reset-security",
  safe(
    superAdminController.forceResetUserSecurity,
    "forceResetUserSecurity"
  )
);

router.post(
  "/override-password",
  safe(
    superAdminController.forceResetUserSecurity,
    "forceResetUserSecurity"
  )
);

// Lock / Unlock User Account
router.patch(
  "/users/toggle-lock",
  safe(superAdminController.toggleWalletLock, "toggleWalletLock")
);

router.post(
  "/toggle-suspension",
  safe(superAdminController.toggleWalletLock, "toggleWalletLock")
);

// ==========================================
// 4. BROADCAST NOTIFICATIONS & MARKETING DISPATCH
// ==========================================
router.post(
  "/broadcast-notification",
  safe(
    superAdminController.broadcastNotification,
    "broadcastNotification"
  )
);

router.post(
  "/vtu/dispatch-bulk",
  safe(superAdminController.dispatchDataBundle, "dispatchDataBundle")
);

router.post(
  "/dispatch-data",
  safe(superAdminController.dispatchDataBundle, "dispatchDataBundle")
);

// ==========================================
// 5. GLOBAL PRICING & TARIFF MATRIX OVERRIDE
// ==========================================
router.post(
  "/pricing/set-global",
  safe(
    superAdminController.setGlobalServicePrice,
    "setGlobalServicePrice"
  )
);

router.post(
  "/update-service-price",
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
  safe(
    superAdminController.expungeSystemAuditLogs,
    "expungeSystemAuditLogs"
  )
);

module.exports = router;