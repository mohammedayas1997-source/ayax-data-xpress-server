const express = require("express");
const router = express.Router();
const { verifyTransactionPin } = require("../middleware/verifyPin");

// 1. Safe Auth Middleware Import
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

// 2. Controller Import
let bvnController = {};
try {
  bvnController = require("../controllers/bvnController");
} catch (e) {
  try {
    bvnController = require("../controllers/nimcController");
  } catch (err) {}
}

// Default Fallback na BVN Prices idan controller bai fitar da shi ba
const defaultBVNPricesHandler = (req, res) => {
  const prices = {
    bvn_standard: 150,
    bvn_premium: 350,
    bvn_phone: 200,
    bvn_basic: 100,
  };
  return res.status(200).json({
    success: true,
    status: "success",
    prices,
    data: prices,
  });
};

// Safe Route Handler Helper
const safe = (fn, fallbackFn) => {
  if (typeof fn === "function") return fn;
  if (typeof fallbackFn === "function") return fallbackFn;
  return (req, res) => {
    return res.status(501).json({
      success: false,
      status: "failed",
      message: "BVN Service endpoint is currently being updated.",
    });
  };
};

// ==========================================
// 1. PUBLIC / PRICING ROUTES
// ==========================================
router.get(
  "/prices",
  safe(
    bvnController.getBVNPrices || bvnController.getPrices,
    defaultBVNPricesHandler
  )
);

router.get(
  "/pricing",
  safe(
    bvnController.getBVNPrices || bvnController.getPrices,
    defaultBVNPricesHandler
  )
);

// ==========================================
// 2. USER ROUTES (Verification & Generation)
// ==========================================

// ✅ WANNAN SHINE AINIHIN ENDPOINT DA KE JIKIN BVNScreen.js
router.post(
  "/verify-and-generate",
  protect,
  verifyTransactionPin,
  safe(
    bvnController.verifyBVN ||
      bvnController.verifyAndGenerate ||
      bvnController.verify ||
      bvnController.submitBVNRequest
  )
);

// Sauran aliases na verification
router.post(
  "/verify",
  protect,
  verifyTransactionPin,
  safe(
    bvnController.verifyBVN ||
      bvnController.verifyAndGenerate ||
      bvnController.verify
  )
);

router.post(
  "/validate",
  protect,
  verifyTransactionPin,
  safe(
    bvnController.verifyBVN ||
      bvnController.verifyAndGenerate ||
      bvnController.verify
  )
);

router.post(
  "/submit",
  protect,
  verifyTransactionPin,
  safe(bvnController.verifyBVN || bvnController.verifyAndGenerate)
);

router.post(
  "/request",
  protect,
  verifyTransactionPin,
  safe(bvnController.verifyBVN || bvnController.verifyAndGenerate)
);

router.get(
  "/my-requests",
  protect,
  safe(bvnController.getMyBVNRequests || bvnController.getUserRequests)
);

router.get(
  "/history",
  protect,
  safe(bvnController.getMyBVNRequests || bvnController.getUserRequests)
);

// ==========================================
// 3. ADMIN MANAGEMENT ROUTES
// ==========================================
router.get(
  "/admin/all",
  protect,
  authorize("admin", "superadmin"),
  safe(bvnController.getAllBVNRequests || bvnController.getAdminRequests)
);

router.patch(
  "/admin/processing/:id",
  protect,
  authorize("admin", "superadmin"),
  safe(bvnController.updateBVNStatus || bvnController.updateToProcessing)
);

router.patch(
  "/admin/approve/:id",
  protect,
  authorize("admin", "superadmin"),
  safe(bvnController.approveBVNRequest || bvnController.approveRequest)
);

router.patch(
  "/admin/reject/:id",
  protect,
  authorize("admin", "superadmin"),
  safe(bvnController.rejectBVNRequest || bvnController.rejectRequest)
);

router.post(
  "/admin/set-price",
  protect,
  authorize("admin", "superadmin"),
  safe(bvnController.setBVNPrice || bvnController.updatePrice)
);

module.exports = router;