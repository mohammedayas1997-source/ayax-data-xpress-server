const express = require("express");
const router = express.Router();
const ninController = require("../controllers/ninController");

// Hanyar karbar sabon validation
router.post("/validate", ninController.submitValidation);

// Hanyar da Admin zai gani dukkan requests (Real Life Admin View)
router.get("/admin/all-requests", async (req, res) => {
  const requests = await ValidationRequest.find().populate(
    "userId",
    "name email",
  );
  res.json(requests);
});

module.exports = router;
