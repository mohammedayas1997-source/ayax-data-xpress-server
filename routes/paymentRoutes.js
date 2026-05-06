const express = require("express");
const router = express.Router();

// Tabbatar da cewa sunan ya yi daidai da yadda aka yi export a paymentController.js
const { handlePaystackWebhook } = require("../controllers/paymentController");

// URL: /api/v1/payments/webhook
// MUHIMMI: Paystack Webhook baya bukatar 'protect' middleware domin sako ne daga Paystack ba daga user ba
router.post("/webhook", handlePaystackWebhook);

module.exports = router;
