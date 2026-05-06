const mongoose = require("mongoose");

const dataPlanSchema = new mongoose.Schema(
  {
    networkName: {
      type: String,
      required: true,
      enum: ["MTN", "GLO", "AIRTEL", "9MOBILE"], // Tabbatar da sunayen networks
    },
    networkId: {
      type: String,
      required: true,
    },
    planCode: {
      type: String,
      required: true,
    },
    planLabel: {
      type: String,
      required: true,
    },
    // Adadin GB (Misali: 1.5 ko 0.5) domin lissafin performance dashboard
    sizeGB: {
      type: Number,
      required: true,
      default: 0,
    },
    // Rarraba kalar data (SME, CG, Gifting)
    planType: {
      type: String,
      default: "SME",
    },
    userPrice: {
      type: Number,
      required: true,
    },
    agentPrice: {
      type: Number,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

// Muna bukatar Indexing anan domin idan user yana neman plans binciken ya yi sauri
dataPlanSchema.index({ networkId: 1, isActive: 1 });

module.exports = mongoose.model("DataPlan", dataPlanSchema);
