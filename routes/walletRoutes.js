const express = require("express");
const router = express.Router();
const {
  getBalance,
  initializePayment,
  verifyPayment,
  fundWalletManual,
} = require("../controllers/walletController");

// Mun tabbatar da sunan authMiddleware don gudun kuskure a Vercel
const { protect, authorize } = require("../middleware/authMiddleware");

// --- WALLET & PAYMENT ROUTES ---

// Duk waɗannan routes ɗin suna buƙatar login
router.use(protect);

// 1. Duba kuɗin da ke cikin wallet
router.get("/balance", getBalance);

// 2. Fara biyan kuɗi ta Paystack (Zai dawo da authorization_url)
router.post("/initialize", initializePayment);

// 3. Tabbatar da biyan kuɗi (Manual verification daga Frontend)
router.get("/verify/:reference", verifyPayment);

// 4. Saka kuɗi na gwaji ko Manual Funding (ADMIN KAWAI)
// MUHIMMI: Mun sanya authorize('admin') don kare wannan route ɗin
router.post("/fund-manual", authorize("admin"), fundWalletManual);

module.exports = router;
