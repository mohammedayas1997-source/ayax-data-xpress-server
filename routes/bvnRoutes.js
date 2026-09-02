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

const protect = authMiddleware.protect || authMiddleware.verifyToken || authMiddleware;
const authorize = authMiddleware.authorize || authMiddleware.restrictTo || ((...roles) => (req, res, next) => next());

// 2. Controller Import
let bvnController = {};
try {
  bvnController = require("../controllers/bvnController");
} catch (e) {
  try {
    bvnController = require("../controllers/nimcController");
  } catch (err) {}
}

// Safe Route Handler Helper
const safe = (fn, name) => {
  if (typeof fn === "function") return fn;
  return (req, res) => {
    return res.status(501).json({
      success: false,
      status: "failed",
      message: `BVN Controller handler '${name}' is not implemented yet.`,
    });
  };
};

// ==========================================
// 1. PUBLIC / PRICING ROUTES
// ==========================================
router.get(
  "/prices",
  safe(bvnController.getBVNPrices || bvnController.getPrices || bvnController.getNIMCPrices, "getBVNPrices")
);

router.get(
  "/pricing",
  safe(bvnController.getBVNPrices || bvnController.getPrices || bvnController.getNIMCPrices, "getBVNPrices")
);

// ==========================================
// 2. USER ROUTES (Verification & Generation)
// ==========================================

// ✅ WANNAN SHINE AINIHIN ENDPOINT DA KE JIKIN SCREEN
router.post(
  "/verify-and-generate",
  protect,
  verifyTransactionPin,
  safe(
    bvnController.verifyBVN ||
      bvnController.verify ||
      bvnController.submitBVNRequest ||
      bvnController.submitNIMCRequest,
    "verifyBVN"
  )
);

// Sauran aliases na verification
router.post(
  "/verify",
  protect,
  verifyTransactionPin,
  safe(bvnController.verifyBVN || bvnController.verify || bvnController.submitBVNRequest, "verifyBVN")
);

router.post(
  "/validate",
  protect,
  verifyTransactionPin,
  safe(bvnController.verifyBVN || bvnController.verify || bvnController.submitBVNRequest, "verifyBVN")
);

router.post(
  "/submit",
  protect,
  verifyTransactionPin,
  safe(bvnController.submitBVNRequest || bvnController.requestBVNModification || bvnController.verifyBVN, "submitBVNRequest")
);

router.post(
  "/request",
  protect,
  verifyTransactionPin,
  safe(bvnController.submitBVNRequest || bvnController.requestBVNModification, "submitBVNRequest")
);

router.get(
  "/my-requests",
  protect,
  safe(bvnController.getMyBVNRequests || bvnController.getUserRequests, "getMyBVNRequests")
);

router.get(
  "/history",
  protect,
  safe(bvnController.getMyBVNRequests || bvnController.getUserRequests, "getMyBVNRequests")
);

// ==========================================
// 3. ADMIN MANAGEMENT ROUTES
// ==========================================
router.get(
  "/admin/all",
  protect,
  authorize("admin", "superadmin"),
  safe(bvnController.getAllBVNRequests || bvnController.getAdminRequests, "getAllBVNRequests")
);

router.patch(
  "/admin/processing/:id",
  protect,
  authorize("admin", "superadmin"),
  safe(bvnController.updateBVNStatus || bvnController.updateToProcessing, "updateBVNStatus")
);

router.patch(
  "/admin/approve/:id",
  protect,
  authorize("admin", "superadmin"),
  safe(bvnController.approveBVNRequest || bvnController.approveRequest, "approveBVNRequest")
);

router.patch(
  "/admin/reject/:id",
  protect,
  authorize("admin", "superadmin"),
  safe(bvnController.rejectBVNRequest || bvnController.rejectRequest, "rejectBVNRequest")
);

router.post(
  "/admin/set-price",
  protect,
  authorize("admin", "superadmin"),
  safe(bvnController.setBVNPrice || bvnController.updatePrice, "setBVNPrice")
);

module.exports = router;