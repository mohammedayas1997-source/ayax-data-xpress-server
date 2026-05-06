const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId, // Mun gyara wannan zuwa Types.ObjectId
      ref: "User",
      required: true,
      index: true, // Indexing don binciken tarihin kudi ya yi sauri
    },
    type: {
      type: String,
      enum: [
        "data",
        "airtime",
        "electricity",
        "cable",
        "wallet_funding",
        "utility",
        "deposit",
      ],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    // Balance din user kafin da bayan wannan transaction din (Audit Trail)
    oldBalance: { type: Number },
    newBalance: { type: Number },

    phoneNumber: String, // Ko kuma Meter Number / SmartCard Number
    status: {
      type: String,
      enum: ["pending", "success", "failed", "refunded"],
      default: "pending",
    },
    reference: {
      type: String,
      unique: true, // Rigakafin double funding
      sparse: true,
    },
    // Karin bayani (misali: "MTN 1GB to 0803...")
    details: {
      type: String,
    },
    refundReason: { type: String },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true, // Wannan zai bamu createdAt da updatedAt kai tsaye
  },
);

// Indexing domin saukin lissafi a Dashboard
TransactionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Transaction", TransactionSchema);
