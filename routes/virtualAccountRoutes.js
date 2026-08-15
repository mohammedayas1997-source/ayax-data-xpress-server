const express = require("express");
const router = express.Router();
const { getOrCreateVirtualAccount } = require("../controllers/virtualAccountController");
const { protect } = require("../middleware/authMiddleware");

// Hanyar da mai amfani zai samu ko ƙirƙirar lambar account ɗinsa
router.post("/create", protect, getOrCreateVirtualAccount);

module.exports = router;