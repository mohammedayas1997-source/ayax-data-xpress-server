const express = require("express");
const router = express.Router();
const { verifyTransactionPin } = require("../middleware/verifyPin");

// 1. Safe Auth Middleware Import (Supports both auth & authMiddleware naming)
let authMiddleware;
try {
  authMiddleware = require("../middleware/authMiddleware");
} catch (e) {
  authMiddleware = require("../middleware/auth");
}

const protect = authMiddleware.protect || authMiddleware.verifyToken || authMiddleware;
const authorize = authMiddleware.authorize || authMiddleware.restrictTo || ((...roles) => (req, res, next) => next());

// 2. Controller Import
const bvnController = require("../controllers/bvnController") || {};

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
  safe(bvnController.getBVNPrices || bvnController.getPrices, "getBVNPrices")
);

router.get(
  "/pricing",
  safe(bvnController.getBVNPrices || bvnController.getPrices, "getBVNPrices")
);

// ==========================================
// 2. USER ROUTES (Verification & Requests)
// ==========================================
router.post(
  "/verify",
  protect,
  safe(bvnController.verifyBVN || bvnController.verify, "verifyBVN")
);

router.post("/verify", protect, verifyTransactionPin, verifyBVN)

router.post(
  "/submit",
  protect,
  safe(bvnController.submitBVNRequest || bvnController.requestBVNModification, "submitBVNRequest")
);

router.post(
  "/request",
  protect,
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