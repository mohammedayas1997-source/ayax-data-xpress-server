const mongoose = require("mongoose");

const BVNRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  serviceType: { type: String, default: "bvn_verification" },
  bvnNumber: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { type: String, default: "completed" },
  details: { type: Object }, // Sakamakon da ya fito daga Dojah
  reference: { type: String },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("BVNRequest", BVNRequestSchema);
