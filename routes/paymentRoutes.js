const express = require("express");
const router = express.Router();

// Tabbatar da cewa sunayen sun yi daidai da yadda aka yi export a paymentController.js
const { handlePaystackWebhook } = require("../controllers/paymentController");

// --- PAYMENT & WEBHOOK ROUTES ---
// MUHIMMI: Webhooks daga Paystack ba su bukatar 'protect' middleware
// domin sako ne daga sabar ta waje kai tsaye zuwa ga server din mu.

// 1. Paystack Webhook (Don karbar bayanan biyan kudi na wallet funding ta Paystack)
router.post("/webhook", handlePaystackWebhook);

module.exports = router;