const mongoose = require("mongoose");

const saleSchema = new mongoose.Schema(
  {
    // Agent din da ya yi tallar
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Supervisor din da yake kula da wannan agent din (Optional a wasu lokuta idan ba Agent karkashin kowa bane)
    supervisorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    // Sunan plan din (misali: MTN SME 1GB, Airtime, da sauransu)
    planName: {
      type: String,
      required: true,
      trim: true,
    },
    // Adadin GB (misali: 1, 2, 5) domin lissafin performance da targets
    dataAmountGB: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Adadin kudin da aka biya (Amount a Naira)
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    // Status din tallar
    status: {
      type: String,
      enum: ["success", "failed", "refunded", "pending"],
      default: "success",
      index: true,
    },
    // Reference daga Transaction model (domin sauƙaƙe bincike da daidaita kuɗi)
    transactionRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      index: true,
    },
  },
  { 
    timestamps: true // Yana samar da createdAt da updatedAt kai tsaye
  },
);

// Ingantattun Indexes domin loda Dashboards da Rapororin Supervisors/Leaders da sauri sosai
saleSchema.index({ supervisorId: 1, createdAt: -1 });
saleSchema.index({ agentId: 1, createdAt: -1 });
saleSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Sale", saleSchema);