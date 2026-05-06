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
    // Supervisor din da yake kula da wannan agent din
    supervisorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Sunan plan din (misali: MTN SME 1GB)
    planName: {
      type: String,
      required: true,
    },
    // Adadin GB (misali: 1, 2, 5) domin lissafin performance
    dataAmountGB: {
      type: Number,
      default: 0,
    },
    // Adadin kudin da aka biya
    amount: {
      type: Number,
      required: true,
    },
    // Status din tallar
    status: {
      type: String,
      enum: ["success", "failed", "refunded"],
      default: "success",
    },
    // Reference daga Transaction model (idan kana so ka hada su)
    transactionRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
    },
  },
  { timestamps: true },
);

// Wannan index din zai taimaka sosai wurin loda Dashboard din Leader da sauri
saleSchema.index({ supervisorId: 1, createdAt: -1 });
saleSchema.index({ agentId: 1, createdAt: -1 });

module.exports = mongoose.model("Sale", saleSchema);
