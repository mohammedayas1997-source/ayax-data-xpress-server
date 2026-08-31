const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },
    userId: {
      type: String,
      index: true,
    },
    transactionId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    reference: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    transactionReference: {
      type: String,
      sparse: true,
      index: true, // Only declare index here
    },
    apiReference: {
      type: String,
      sparse: true,
    },
    type: {
      type: String,
      required: true,
      index: true,
    },
    category: {
      type: String,
      default: "UTILITY",
      index: true,
    },
    service: {
      type: String,
    },
    amount: {
      type: Number,
      required: true,
      default: 0,
    },
    oldBalance: {
      type: Number,
      default: 0,
    },
    newBalance: {
      type: Number,
      default: 0,
    },
    previousBalance: {
      type: Number,
      default: 0,
    },
    phoneNumber: {
      type: String,
      index: true,
    },
    recipient: {
      type: String,
      index: true,
    },
    meterNumber: {
      type: String,
    },
    nin: {
      type: String,
    },
    bvn: {
      type: String,
    },
    provider: {
      type: String,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "processing",
        "success",
        "completed",
        "failed",
        "refunded",
        "pending-refund",
        "refund_requested",
      ],
      default: "pending",
      index: true,
    },
    description: {
      type: String,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
    },
    isRefunded: {
      type: Boolean,
      default: false,
    },
    refundReason: {
      type: String,
    },
    refundedAt: {
      type: Date,
    },
    refundedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

// Removed duplicate transactionSchema.index({ transactionReference: 1 }) to prevent mongoose warning

module.exports = mongoose.models.Transaction || mongoose.model("Transaction", transactionSchema);