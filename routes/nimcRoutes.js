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

// 2. Controller Functions
const nimcController = require("../controllers/nimcController");

// Safe Route Handler Helper
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
router.get(
  "/prices",
  safe(nimcController.getNIMCPrices || nimcController.getPrices, "getNIMCPrices")
);

router.get(
  "/pricing",
  safe(nimcController.getNIMCPrices || nimcController.getPrices, "getNIMCPrices")
);

// ==========================================
// 2. USER ROUTES (Submissions, Direct Search, & History)
// ==========================================
// Live verification lookup
router.post(
  "/verify",
  protect,
  safe(nimcController.verifyNIMC || nimcController.verify, "verifyNIMC")
);

// Submit new application / modification
router.post(
  "/submit",
  protect,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.post(
  "/request-modification",
  protect,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.put(
  "/submit",
  protect,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

// User application history
router.get(
  "/my-requests",
  protect,
  safe(nimcController.getMyNIMCRequests, "getMyNIMCRequests")
);

router.get(
  "/history",
  protect,
  safe(nimcController.getMyNIMCRequests, "getMyNIMCRequests")
);

// ==========================================
// 3. ADMIN / SUPERADMIN MANAGEMENT ROUTES
// ==========================================
router.get(
  "/admin/all",
  protect,
  authorize("admin", "superadmin"),
  safe(nimcController.getAllNIMCRequests, "getAllNIMCRequests")
);

router.get(
  "/admin/requests",
  protect,
  authorize("admin", "superadmin"),
  safe(nimcController.getAllNIMCRequests, "getAllNIMCRequests")
);

router.patch(
  "/admin/processing/:id",
  protect,
  authorize("admin", "superadmin"),
  safe(nimcController.updateToProcessing, "updateToProcessing")
);

router.put(
  "/admin/processing/:id",
  protect,
  authorize("admin", "superadmin"),
  safe(nimcController.updateToProcessing, "updateToProcessing")
);

router.patch(
  "/admin/approve/:id",
  protect,
  authorize("admin", "superadmin"),
  safe(nimcController.approveRequest, "approveRequest")
);

router.put(
  "/admin/approve/:id",
  protect,
  authorize("admin", "superadmin"),
  safe(nimcController.approveRequest, "approveRequest")
);


router.patch(
  "/admin/reject/:id",
  protect,
  authorize("admin", "superadmin"),
  safe(nimcController.rejectRequest || nimcController.rejectNIMCRequest, "rejectRequest")
);

router.post("/submit-request", protect, verifyTransactionPin, submitNIMCRequest);
router.post("/request-modification", protect, verifyTransactionPin, submitNIMCRequest);

router.post(
  "/admin/set-price",
  protect,
  authorize("admin", "superadmin"),
  safe(nimcController.setNIMCPrice || nimcController.setPrice, "setNIMCPrice")
);

module.exports = router;