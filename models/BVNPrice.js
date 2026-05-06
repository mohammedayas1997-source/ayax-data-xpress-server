const mongoose = require("mongoose");

const BVNPriceSchema = new mongoose.Schema({
  serviceType: {
    type: String,
    required: true,
    unique: true,
    enum: ["bvn_full", "bvn_basic", "bvn_face", "bvn_phone"], // Wadannan sune nau'ikan BVN din
  },
  amount: { type: Number, required: true },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("BVNPrice", BVNPriceSchema);
