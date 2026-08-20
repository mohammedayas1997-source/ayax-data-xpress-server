const express = require("express");
const router = express.Router();
const {
  getBalance,
  initializePayment,
  verifyPayment,
  fundWalletManual,
  generateVirtualAccount,
  paystackWebhook, // Tabbatar akwai wannan a walletController
} = require("../controllers/walletController");

const { protect, authorize } = require("../middleware/authMiddleware");

// =========================================================================
// 1. PUBLIC ROUTES (BABU BUKATAR LOGIN TOKEN)
// =========================================================================

// Paystack Webhook: Wannan yana karbar sanarwar kudi kai tsaye daga Paystack Server
if (typeof paystackWebhook === "function") {
  router.post("/paystack/webhook", paystackWebhook);
  router.post("/webhook", paystackWebhook);
}

// =========================================================================
// 2. PROTECTED ROUTES (DOLE SAI MAI AMFANI YA YI LOGIN)
// =========================================================================
router.use(protect);

// Ƙirƙira ko sabunta Paystack Virtual Account
router.post("/generate-virtual-account", generateVirtualAccount);

// Duba kuɗin da ke cikin wallet (Balance)
router.get("/balance", getBalance);

// Fara biyan kuɗi ko saka kudi ta Paystack
router.post("/initialize", initializePayment);

// Tabbatar da biyan kuɗin Paystack ta Reference
router.get("/verify/:reference", verifyPayment);

// Saka kuɗi da hannu (ADMIN / SUPERADMIN KAWAI)
router.post(
  "/fund-manual",
  authorize("admin", "superadmin"),
  fundWalletManual
);

module.exports = router;