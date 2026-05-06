const express = require("express");
const router = express.Router();

// Tabbatar da cewa 'webhookController' yana nan kuma sunan aikin ya yi daidai
const { handlePaystackWebhook } = require("../controllers/webhookController");

// URL: /api/v1/webhooks/paystack
// MUHIMMI: Kada ka saka 'protect' middleware a nan!
router.post("/paystack", handlePaystackWebhook);

module.exports = router;
