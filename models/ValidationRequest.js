const mongoose = require("mongoose");

const ValidationSchema = new mongoose.Schema({
  type: { type: String, required: true }, // Misali: 'SIM Validation'
  nin: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { type: String, default: "pending" }, // 'pending', 'completed', 'failed'
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("ValidationRequest", ValidationSchema);
