// models/NIMCRequest.js
const mongoose = require("mongoose");

const NIMCRequestSchema = new mongoose.Schema(
  {
    // Mai amfani da ya yi buƙatar NIMC service
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Haɗi da table ɗin User
      required: true,
      index: true,
    },

    // Nau'in sabis din NIMC (Misali: Modification, Renewal, NIN Verification, NIN Premium, Slip Printing)
    serviceType: {
      type: String,
      required: [
        true,
        "Please specify the service type (e.g., Modification, Renewal)",
      ],
      trim: true,
      index: true,
    },

    // Lambar NIN ta mai amfani
    ninNumber: {
      type: String,
      required: [true, "NIN Number is required"],
      trim: true,
      index: true,
    },

    // Dukkan sauran bayanan form ɗin a matsayin JSON/Object (Misali: Sunan mahaifi, adireshin da za a gyara, da sauransu)
    formData: {
      type: mongoose.Schema.Types.Mixed, 
      required: true,
      default: {},
    },

    // Adadin kudin da aka cire
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Matsayin buƙatar (status)
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "rejected", "success"],
      default: "pending",
      index: true,
    },

    // Link ɗin hoton slip ko takardar sakamako da Admin zai yi upload ko kuma API ya dawo da shi
    slipUrl: {
      type: String, 
      default: null,
    },

    // Cikakken sakamakon da ya fito daga API (Idan akwai) ko bayanin amsa daga Admin
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Lambar Transaction ID ko Reference don daidaita kudi da ma'amala
    transactionId: {
      type: String,
      index: true,
      sparse: true,
    },

    reference: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    // Lokacin da aka kammala ko warware buƙatar
    resolvedAt: {
      type: Date,
    },
  },
  { 
    timestamps: true // Zai samar da 'createdAt' da 'updatedAt' kai tsaye 
  }
);

// Ingantattun Indexes don saurin bincike a cikin Dashboard da Admin Panel
NIMCRequestSchema.index({ user: 1, createdAt: -1 });
NIMCRequestSchema.index({ status: 1, createdAt: -1 });
NIMCRequestSchema.index({ serviceType: 1, status: 1 });

module.exports = mongoose.model("NIMCRequest", NIMCRequestSchema);