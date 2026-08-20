const express = require("express");
const router = express.Router();

const { protect, authorize } = require("../middleware/authMiddleware");
const bvnController = require("../controllers/bvnController") || {};

// Safe Handler Helper
const safe = (fn, name) => {
  if (typeof fn === "function") return fn;
  return (req, res) => {
    res.status(501).json({
      success: false,
      message: `BVN Controller '${name}' is not implemented yet.`,
    });
  };
};

// --- USER ROUTES ---
router.post(
  "/submit",
  protect,
  safe(bvnController.submitBVNRequest || bvnController.requestBVNModification, "submitBVNRequest")
);

router.post(
  "/verify",
  protect,
  safe(bvnController.verifyBVN, "verifyBVN")
);

router.get(
  "/my-requests",
  protect,
  safe(bvnController.getMyBVNRequests || bvnController.getUserRequests, "getMyBVNRequests")
);

// --- ADMIN ROUTES ---
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

module.exports = router;