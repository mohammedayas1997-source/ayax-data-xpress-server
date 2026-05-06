const mongoose = require("mongoose");

const NIMCPriceSchema = new mongoose.Schema({
  serviceType: {
    type: String,
    required: true,
    unique: true,
    enum: ["nin_verification", "nin_premium", "nin_search"], // Nau'ikan NIMC
  },
  amount: { type: Number, required: true },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("NIMCPrice", NIMCPriceSchema);
