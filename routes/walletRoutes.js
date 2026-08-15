const express = require("express");
const router = express.Router();
const {
  getBalance,
  initializePayment,
  verifyPayment,
  fundWalletManual,
  generateVirtualAccount,
} = require("../controllers/walletController");

const { protect, authorize } = require("../middleware/authMiddleware");

// --- WALLET & PAYMENT ROUTES ---

// Duk waɗannan routes ɗin suna buƙatar mai amfani ya yi login (Authenticated)
router.use(protect);

// 1. Ƙirƙira ko sabunta Paystack Virtual Account (Asusun banki na musamman na mai amfani)
router.post("/generate-virtual-account", generateVirtualAccount);

// 2. Duba kuɗin da ke cikin wallet (Balance)
router.get("/balance", getBalance);

// 3. Fara biyan kuɗi ko saka kudi ta Paystack (Zai dawo da authorization_url)
router.post("/initialize", initializePayment);

// 4. Tabbatar da biyan kuɗin Paystack (Verification ta hanyar reference)
router.get("/verify/:reference", verifyPayment);

// 5. Saka kuɗi da hannu ko Manual Funding (ADMIN / SUPERADMIN KAWAI)
router.post("/fund-manual", authorize("admin", "superadmin"), fundWalletManual);

module.exports = router;