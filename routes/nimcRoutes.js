const express = require("express");
const router = express.Router();

// 1. Dynamic Middleware Loaders
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

let verifyTransactionPin = (req, res, next) => next();
try {
  const pinMod = require("../middleware/verifyPin");
  verifyTransactionPin = pinMod.verifyTransactionPin || pinMod;
} catch (p) {}

// 2. Controller Functions
const nimcController = require("../controllers/nimcController");

// Safe Handler Helper
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
// 2. QUICK DIRECT LOOKUP (Babu caji / Babu PIN)
// ==========================================
router.post("/verify", protect, safe(nimcController.verifyNIMC || nimcController.verify, "verifyNIMC"));
router.post("/verify-nin", protect, safe(nimcController.verifyNIMC || nimcController.verify, "verifyNIMC"));
router.post("/nin-verify", protect, safe(nimcController.verifyNIMC || nimcController.verify, "verifyNIMC"));

// ==========================================
// 3. SUBMIT VALIDATION / REQUESTS (Tare da PIN & Charge)
// ==========================================
// ✅ WANNAN SHINE KE KAWO KUSKUREN JIKIN HOTO:
router.post(
  "/validate-request",
  protect,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.post(
  "/validate",
  protect,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.post(
  "/validate-nin",
  protect,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.post(
  "/verify-and-charge",
  protect,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.post(
  "/submit",
  protect,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.post(
  "/submit-request",
  protect,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.post(
  "/request-modification",
  protect,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.post(
  "/process",
  protect,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

router.post(
  "/pay",
  protect,
  verifyTransactionPin,
  safe(nimcController.submitNIMCRequest, "submitNIMCRequest")
);

// ==========================================
// 4. USER HISTORY
// ==========================================
router.get("/my-requests", protect, safe(nimcController.getMyNIMCRequests, "getMyNIMCRequests"));
router.get("/history", protect, safe(nimcController.getMyNIMCRequests, "getMyNIMCRequests"));

// ==========================================
// 5. ADMIN CONTROLS
// ==========================================
router.post(
  "/update-price",
  protect,
  authorize("admin", "superadmin"),
  safe(nimcController.setNIMCPrice, "setNIMCPrice")
);

router.post(
  "/admin/update-price",
  protect,
  authorize("admin", "superadmin"),
  safe(nimcController.setNIMCPrice, "setNIMCPrice")
);

router.post(
  "/admin/set-price",
  protect,
  authorize("admin", "superadmin"),
  safe(nimcController.setNIMCPrice, "setNIMCPrice")
);

router.get("/admin/all", protect, authorize("admin", "superadmin"), safe(nimcController.getAllNIMCRequests, "getAllNIMCRequests"));
router.get("/admin/requests", protect, authorize("admin", "superadmin"), safe(nimcController.getAllNIMCRequests, "getAllNIMCRequests"));
router.patch("/admin/processing/:id", protect, authorize("admin", "superadmin"), safe(nimcController.updateToProcessing, "updateToProcessing"));
router.put("/admin/processing/:id", protect, authorize("admin", "superadmin"), safe(nimcController.updateToProcessing, "updateToProcessing"));
router.patch("/admin/approve/:id", protect, authorize("admin", "superadmin"), safe(nimcController.approveRequest, "approveRequest"));
router.put("/admin/approve/:id", protect, authorize("admin", "superadmin"), safe(nimcController.approveRequest, "approveRequest"));
router.patch("/admin/reject/:id", protect, authorize("admin", "superadmin"), safe(nimcController.rejectRequest, "rejectRequest"));

module.exports = router;