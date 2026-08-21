const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth.middleware"); // ko kuma inda auth middleware yake
const dataController = require("../controllers/vtuController"); // ko "../controllers/dataController"
const dataPlanController = require("../controllers/dataPlanController");

/* ======================================================
   PUBLIC / USER DATA ROUTES
====================================================== */

// Dauko plans masu aiki (Active Plans)
router.get("/plans", (req, res, next) => {
  if (typeof dataPlanController.getPlans === "function") {
    return dataPlanController.getPlans(req, res, next);
  }
  return res.status(404).json({ success: false, message: "Plans handler not found" });
});

/* ======================================================
   AUTHENTICATED ROUTES (Bayan Login)
====================================================== */
router.use(auth);

// Siyan Data (yana karbar /buy ko kai tsaye a root POST /)
router.post("/buy", dataController.buyData);
router.post("/", dataController.buyData);

module.exports = router;