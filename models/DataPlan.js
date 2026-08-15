const mongoose = require("mongoose");

const dataPlanSchema = new mongoose.Schema(
  {
    networkName: {
      type: String,
      required: true,
      enum: ["MTN", "GLO", "AIRTEL", "9MOBILE"], // Tabbatar da sunayen networks
      index: true,
    },
    networkId: {
      type: String,
      required: true,
      index: true,
    },
    planCode: {
      type: String,
      required: true,
      index: true,
    },
    planLabel: {
      type: String,
      required: true,
      trim: true,
    },
    // Adadin GB (Misali: 1.5 ko 0.5) domin lissafin performance dashboard da agent targets
    sizeGB: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    // Rarraba kalar data (Misali: SME, CG, Gifting, Direct)
    planType: {
      type: String,
      default: "SME",
      enum: ["SME", "GIFTING", "CG", "CORPORATE_GIFTING", "DIRECT"],
      index: true,
    },
    userPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    agentPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    // Farashin da tsarin API ke cirewa (Optional - domin lissafin riba ko cost)
    apiCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

// Ingantattun Indexes don saurin bincike da filtara a lokacin sayar da data
dataPlanSchema.index({ networkId: 1, isActive: 1 });
dataPlanSchema.index({ networkName: 1, planType: 1, isActive: 1 });

module.exports = mongoose.model("DataPlan", dataPlanSchema);