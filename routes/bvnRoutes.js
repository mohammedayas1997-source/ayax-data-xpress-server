const express = require("express");
const router = express.Router();

// 1. Safe Auth Middleware Import
let authMiddleware;
try {
  authMiddleware = require("../middleware/authMiddleware");
} catch (e) {
  authMiddleware = require("../middleware/auth");
}

const protect =
  authMiddleware?.protect || authMiddleware?.verifyToken || authMiddleware || ((req, res, next) => next());

const authorize =
  authMiddleware?.authorize ||
  authMiddleware?.restrictTo ||
  ((...roles) => (req, res, next) => next());

// 2. Safe Dynamic Controller Accessor
const getController = () => {
  try {
    return require("../controllers/bvnController");
  } catch (e) {
    console.error("Dynamic BVN Controller Load Error:", e.message);
    return null;
  }
};

// Dynamic Route Invoker (Yana duba aikin a ainihin lokacin da request ya shigo)
const invoke = (methodName, fallbackFn) => (req, res, next) => {
  const ctrl = getController();
  if (ctrl && typeof ctrl[methodName] === "function") {
    return ctrl[methodName](req, res, next);
  }
  if (typeof fallbackFn === "function") {
    return fallbackFn(req, res, next);
  }
  return res.status(501).json({
    success: false,
    status: "failed",
    message: `BVN handler [${methodName}] is currently unavailable on server.`,
  });
};

// Default Fallback na BVN Prices
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

// ==========================================
// 1. PUBLIC / PRICING ROUTES
// ==========================================
router.get("/prices", invoke("getBVNPrices", defaultBVNPricesHandler));
router.get("/pricing", invoke("getBVNPrices", defaultBVNPricesHandler));

// ==========================================
// 2. USER ROUTES (Verification & Slip Generation)
// ==========================================

// Babban kiran da ke jikin BVNScreen.js
router.post(
  "/verify-and-generate",
  protect,
  invoke("verifyBVN", (req, res, next) => invoke("verifyAndGenerate")(req, res, next))
);

// Sauran aliases
router.post("/verify", protect, invoke("verifyBVN"));
router.post("/submit", protect, invoke("verifyBVN"));
router.post("/request", protect, invoke("verifyBVN"));

router.get("/my-requests", protect, invoke("getMyBVNRequests"));
router.get("/history", protect, invoke("getMyBVNRequests"));

// ==========================================
// 3. ADMIN MANAGEMENT ROUTES
// ==========================================
router.get("/admin/all", protect, authorize("admin", "superadmin"), invoke("getAllBVNRequests"));
router.patch("/admin/processing/:id", protect, authorize("admin", "superadmin"), invoke("updateBVNStatus"));
router.patch("/admin/approve/:id", protect, authorize("admin", "superadmin"), invoke("approveBVNRequest"));
router.patch("/admin/reject/:id", protect, authorize("admin", "superadmin"), invoke("rejectBVNRequest"));
router.get("/download-slip", bvnController.downloadBVNSlip);
// Kafar saita farashi don Admin
router.post("/admin/set-price", protect, authorize("admin", "superadmin"), invoke("setBVNPrice"));
router.post("/admin/update-price", protect, authorize("admin", "superadmin"), invoke("setBVNPrice"));

module.exports = router;