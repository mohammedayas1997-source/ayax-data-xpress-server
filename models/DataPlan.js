const mongoose = require("mongoose");

const dataPlanSchema = new mongoose.Schema(
  {
    // Network Details
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

    // Gateway / API Provider Routing (AYAX ko ALIHSAN)
    gateway: {
      type: String,
      uppercase: true,
      trim: true,
      default: "AYAX",
      index: true,
    },
    provider: {
      type: String,
      uppercase: true,
      trim: true,
      default: "AYAX",
      index: true,
    },

    // Plan IDs
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

    // Bayanin Plan (misali 1.0 GB / 2.0 GB)
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

    // Girman Data
    sizeGB: {
      type: Number,
      default: 1,
      min: 0,
    },

    // Nau'in Plan (SME, CG, DC, Awoof, Gifting)
    planType: {
      type: String,
      trim: true,
      default: "SME",
    },
    type: {
      type: String,
      trim: true,
      default: "SME",
    },

    // Tsawon Lokaci
    validity: {
      type: String,
      default: "30 Days",
      trim: true,
    },

    // Farashi
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

    // Yanayi
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
    strict: false 
  }
);

// Auto-fill & Smart Routing Hook kafin adanawa a Database
dataPlanSchema.pre("save", function (next) {
  // Daidaita Plan ID
  if (!this.planCode && this.planId) this.planCode = this.planId;
  if (!this.planId && this.planCode) this.planId = this.planCode;
  if (!this.id) this.id = this.planId || this.planCode;

  // Smart Network Auto-Detection bisa lambar Plan ID
  const numId = parseInt(this.planId || this.id, 10);
  if (!isNaN(numId)) {
    if (numId >= 100 && numId <= 200) {
      if (!this.network) this.network = "MTN";
      if (!this.networkId) this.networkId = "1";
    } else if (numId >= 201 && numId <= 300) {
      if (!this.network) this.network = "AIRTEL";
      if (!this.networkId) this.networkId = "2";
    } else if (numId >= 301 && numId <= 400) {
      if (!this.network) this.network = "GLO";
      if (!this.networkId) this.networkId = "4";
    } else if (numId >= 401 && numId <= 500) {
      if (!this.network) this.network = "9MOBILE";
      if (!this.networkId) this.networkId = "3";
    }
  }

  // Daidaita Network da Sunaye
  if (!this.network && this.networkName) this.network = this.networkName;
  if (!this.networkName && this.network) this.networkName = this.network;
  if (!this.name && this.planLabel) this.name = this.planLabel;
  if (!this.planLabel && this.name) this.planLabel = this.name;
  if (!this.price && this.userPrice) this.price = this.userPrice;
  if (!this.userPrice && this.price) this.userPrice = this.price;

  // Daidaita Gateway
  if (!this.gateway && this.provider) this.gateway = this.provider;
  if (!this.provider && this.gateway) this.provider = this.gateway;

  next();
});

dataPlanSchema.index({ network: 1, isActive: 1 });
dataPlanSchema.index({ networkName: 1, planType: 1, isActive: 1 });
dataPlanSchema.index({ planId: 1 });
dataPlanSchema.index({ planCode: 1 });
dataPlanSchema.index({ gateway: 1 });

module.exports = mongoose.model("DataPlan", dataPlanSchema);