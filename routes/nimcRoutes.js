const express = require("express");
const router = express.Router();

// 1. Robust Middleware Import with Direct Fallback Resolution
let authMiddleware = {};
try {
  authMiddleware = require("../middleware/authMiddleware");
} catch (e) {
  try {
    authMiddleware = require("../middleware/auth");
  } catch (err) {
    authMiddleware = {};
  }
}

// Ensure protect rejects unauthenticated requests instead of passing null req.user
const protect =
  authMiddleware.protect ||
  authMiddleware.verifyToken ||
  ((req, res, next) => {
    if (!req.user && !req.apiUser) {
      return res.status(401).json({
        success: false,
        status: "failed",
        message: "Authentication required. Please login again.",
      });
    }
    next();
  });

const authorize =
  authMiddleware.authorize ||
  authMiddleware.restrictTo ||
  ((...roles) => (req, res, next) => {
    const userRole = req.user?.role || req.apiUser?.role;
    if (!roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        status: "failed",
        message: "Unauthorized access.",
      });
    }
    next();
  });

// Transaction PIN Middleware with Safe Fallback
let verifyTransactionPin = (req, res, next) => next();
try {
  const pinMod = require("../middleware/verifyPin");
  if (typeof pinMod === "function") {
    verifyTransactionPin = pinMod;
  } else if (pinMod && typeof pinMod.verifyTransactionPin === "function") {
    verifyTransactionPin = pinMod.verifyTransactionPin;
  }
} catch (p) {}

// Safe Wrapper to guarantee req.user exists before hitting PIN or Controller
const ensureAuthenticatedUser = (req, res, next) => {
  const user = req.user || req.apiUser;
  if (!user || (!user.id && !user._id)) {
    return res.status(401).json({
      success: false,
      status: "failed",
      message: "Session expired or invalid. Please re-login.",
    });
  }
  next();
};

// 2. Controller Functions
const nimcController = require("../controllers/nimcController");

const safe = (fn, name) => {
  if (typeof fn === "function") return fn;
  return (req, res) => {
    return res.status(501).json({
      success: false,
      status: "failed",
      message: `NIMC Controller handler '${name}' is not implemented yet.`,
    });
  };
};

// ==========================================
// 1. PUBLIC & PRICING ROUTES
// ==========================================
router.get("/prices", safe(nimcController.getNIMCPrices || nimcController.getPrices, "getNIMCPrices"));
router.get("/pricing", safe(nimcController.getNIMCPrices || nimcController.getPrices, "getNIMCPrices"));

// ==========================================
// 2. QUICK DIRECT LOOKUP
// ==========================================
router.post(
  "/verify",
  protect,
  ensureAuthenticatedUser,
  safe(nimcController.verifyNIMC || nimcController.verify, "verifyNIMC")
);
router.post(
  "/verify-nin",
  protect,
  ensureAuthenticatedUser,
  safe(nimcController.verifyNIMC || nimcController.verify, "verifyNIMC")
);
router.post(
  "/nin-verify",
  protect,
  ensureAuthenticatedUser,
  safe(nimcController.verifyNIMC || nimcController.verify, "verifyNIMC")
);

// ==========================================
// 3. SUBMIT VALIDATION / REQUESTS
// ==========================================
router.post(
  "/validate-request",
  protect,
  ensureAuthenticatedUser,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.post(
  "/validate",
  protect,
  ensureAuthenticatedUser,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.post(
  "/validate-nin",
  protect,
  ensureAuthenticatedUser,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.post(
  "/verify-and-charge",
  protect,
  ensureAuthenticatedUser,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.post(
  "/submit",
  protect,
  ensureAuthenticatedUser,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.post(
  "/submit-request",
  protect,
  ensureAuthenticatedUser,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.post(
  "/request-modification",
  protect,
  ensureAuthenticatedUser,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.post(
  "/process",
  protect,
  ensureAuthenticatedUser,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.post(
  "/pay",
  protect,
  ensureAuthenticatedUser,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

// ==========================================
// 4. USER HISTORY
// ==========================================
router.get(
  "/my-requests",
  protect,
  ensureAuthenticatedUser,
  safe(nimcController.getMyNIMCRequests, "getMyNIMCRequests")
);
router.get(
  "/history",
  protect,
  ensureAuthenticatedUser,
  safe(nimcController.getMyNIMCRequests, "getMyNIMCRequests")
);

// ==========================================
// 5. ADMIN CONTROLS
// ==========================================
router.post(
  "/update-price",
  protect,
  ensureAuthenticatedUser,
  authorize("admin", "superadmin"),
  safe(nimcController.setNIMCPrice, "setNIMCPrice")
);

router.post(
  "/admin/update-price",
  protect,
  ensureAuthenticatedUser,
  authorize("admin", "superadmin"),
  safe(nimcController.setNIMCPrice, "setNIMCPrice")
);

router.post(
  "/admin/set-price",
  protect,
  ensureAuthenticatedUser,
  authorize("admin", "superadmin"),
  safe(nimcController.setNIMCPrice, "setNIMCPrice")
);

router.get(
  "/admin/all",
  protect,
  ensureAuthenticatedUser,
  authorize("admin", "superadmin"),
  safe(nimcController.getAllNIMCRequests, "getAllNIMCRequests")
);
router.get(
  "/admin/requests",
  protect,
  ensureAuthenticatedUser,
  authorize("admin", "superadmin"),
  safe(nimcController.getAllNIMCRequests, "getAllNIMCRequests")
);
router.patch(
  "/admin/processing/:id",
  protect,
  ensureAuthenticatedUser,
  authorize("admin", "superadmin"),
  safe(nimcController.updateToProcessing, "updateToProcessing")
);
router.put(
  "/admin/processing/:id",
  protect,
  ensureAuthenticatedUser,
  authorize("admin", "superadmin"),
  safe(nimcController.updateToProcessing, "updateToProcessing")
);
router.patch(
  "/admin/approve/:id",
  protect,
  ensureAuthenticatedUser,
  authorize("admin", "superadmin"),
  safe(nimcController.approveRequest, "approveRequest")
);
router.put(
  "/admin/approve/:id",
  protect,
  ensureAuthenticatedUser,
  authorize("admin", "superadmin"),
  safe(nimcController.approveRequest, "approveRequest")
);
router.patch(
  "/admin/reject/:id",
  protect,
  ensureAuthenticatedUser,
  authorize("admin", "superadmin"),
  safe(nimcController.rejectRequest, "rejectRequest")
);

module.exports = router;