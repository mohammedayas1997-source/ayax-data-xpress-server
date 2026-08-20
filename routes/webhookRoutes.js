const express = require("express");
const router = express.Router();

// Dauko controller
const { handlePaystackWebhook } = require("../controllers/webhookController");

// MUHIMMI: Kada a saka 'protect' middleware a nan domin Paystack ne ke kiran wadannan routes din kai tsaye!

// 1. Asalin kofar Paystack: /api/v1/webhooks/paystack
router.post("/paystack", handlePaystackWebhook);

// 2. Kofofi na kari (Aliases) don rigakafin kuskuren URL:
// Misali: /api/v1/webhooks/ da /api/v1/webhooks/webhook
router.post("/", handlePaystackWebhook);
router.post("/webhook", handlePaystackWebhook);
router.post("/paystack-webhook", handlePaystackWebhook);

module.exports = router;