const mongoose = require("mongoose");

const dataPlanSchema = new mongoose.Schema(
  {
    // Yana karbar network ko networkName
    network: {
      type: String,
      uppercase: true,
      trim: true,
      index: true,
    },
    networkName: {
      type: String,
      uppercase: true,
      trim: true,
      index: true,
    },
    networkId: {
      type: String,
      trim: true,
      default: "1",
    },

    // Ainihin lambar Al-Ihsan Provider ID (misali 157, 158, 200, 255, 140, 27)
    id: {
      type: String,
      trim: true,
      index: true,
    },
    planId: {
      type: String,
      trim: true,
      index: true,
    },
    planCode: {
      type: String,
      trim: true,
      index: true,
    },
    code: {
      type: String,
      trim: true,
    },

    // Sunan Plan (misali 1.0 GB / 2.0 GB / 3GB)
    name: {
      type: String,
      trim: true,
    },
    plan: {
      type: String,
      trim: true,
    },
    planLabel: {
      type: String,
      trim: true,
    },

    // Adadin GB don lissafi
    sizeGB: {
      type: Number,
      default: 1,
      min: 0,
    },

    // Nau'in Plan (SME, CG, DC, Awoof, Gifting)
    planType: {
      type: String,
      trim: true,
      default: "DC",
    },
    type: {
      type: String,
      trim: true,
      default: "DC",
    },

    // Tsawon lokaci (misali 30 Days, 7 Days)
    validity: {
      type: String,
      default: "30 Days",
      trim: true,
    },

    // Farashin Siyarwa
    userPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    price: {
      type: Number,
      default: 0,
      min: 0,
    },
    agentPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    costPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    apiCost: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Yanayin Plan
    status: {
      type: String,
      default: "active",
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { 
    timestamps: true,
    strict: false // Yana ba da damar ajiye dukkan filayen da ba a rubuta ba ba tare da kuskure ba
  }
);

// Auto-fill Hook: Tabbatar da an daidaita filaye kafin adanawa
dataPlanSchema.pre("save", function (next) {
  if (!this.network && this.networkName) this.network = this.networkName;
  if (!this.networkName && this.network) this.networkName = this.network;
  if (!this.planCode && this.planId) this.planCode = this.planId;
  if (!this.planId && this.planCode) this.planId = this.planCode;
  if (!this.id) this.id = this.planId || this.planCode;
  if (!this.name && this.planLabel) this.name = this.planLabel;
  if (!this.planLabel && this.name) this.planLabel = this.name;
  if (!this.price && this.userPrice) this.price = this.userPrice;
  if (!this.userPrice && this.price) this.userPrice = this.price;
  next();
});

dataPlanSchema.index({ network: 1, isActive: 1 });
dataPlanSchema.index({ networkName: 1, planType: 1, isActive: 1 });
dataPlanSchema.index({ planId: 1 });
dataPlanSchema.index({ planCode: 1 });

module.exports = mongoose.model("DataPlan", dataPlanSchema);