const express = require("express");
const router = express.Router();
const {
  getGlobalDataOverview,
  dispatchDataBundle,
  processRefundSuperAdminOnly,
  adjustUserWallet,
  toggleWalletLock,
} = require("../controllers/superAdminMasterController");

router.get("/stats", getGlobalDataOverview);
router.post("/dispatch-data", dispatchDataBundle);
router.post("/process-refund", processRefundSuperAdminOnly);
router.post("/adjust-wallet", adjustUserWallet);
router.post("/toggle-wallet", toggleWalletLock);

module.exports = router;