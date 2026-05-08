const mongoose = require("mongoose");

const SupportRequestSchema = new mongoose.Schema({
  transactionId: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  }, // Support person
  reason: { type: String, required: true }, // Misali: "Wrong transfer" ko "Data not delivered"
  supportNote: { type: String },
  status: {
    type: String,
    enum: ["pending", "resolved", "rejected"],
    default: "pending",
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("SupportRequest", SupportRequestSchema);
