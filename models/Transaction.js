const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema(
  {
    // 1. User Relational Association
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // 2. Unique Transaction Identifiers
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

    apiReference: {
      type: String,
      sparse: true,
      index: true,
      trim: true,
    },

    // 3. Complete Ayax Xpress & VTU Services
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
        "transfer",
        "refund",
        "nin_verification",
        "nin_validation",
        "nin_slip",
        "bvn_verification",
        "bvn_slip",
        "nimc_modification",
      ],
      required: true,
      index: true,
    },

    category: {
      type: String,
      enum: ["DEBIT", "CREDIT"],
      default: "DEBIT",
      index: true,
    },

    // 4. Financial Breakdown & Audit Trail
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    fee: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalAmount: {
      type: Number,
      default: function () {
        return (this.amount || 0) + (this.fee || 0);
      },
    },

    oldBalance: {
      type: Number,
      default: 0,
    },

    newBalance: {
      type: Number,
      default: 0,
    },

    // 5. Target Identification & Destination Details
    phoneNumber: {
      type: String,
      trim: true,
      index: true,
    },

    meterNumber: {
      type: String,
      trim: true,
      index: true,
    },

    smartCardNumber: {
      type: String,
      trim: true,
      index: true,
    },

    nin: {
      type: String,
      trim: true,
      index: true,
    },

    bvn: {
      type: String,
      trim: true,
      index: true,
    },

    provider: {
      type: String,
      trim: true,
      index: true,
    },

    planCode: {
      type: String,
      trim: true,
    },

    // 6. Utility Specific Generation Outputs (Token, Units, Slip URLs)
    token: {
      type: String,
      trim: true,
    },

    units: {
      type: String,
      trim: true,
    },

    slipUrl: {
      type: String,
      trim: true,
    },

    pdfUrl: {
      type: String,
      trim: true,
    },

    // 7. Transaction Lifecycle & Status
    status: {
      type: String,
      enum: ["pending", "processing", "success", "successful", "failed", "refunded", "cancelled"],
      default: "pending",
      index: true,
    },

    details: {
      type: String,
      trim: true,
    },

    channel: {
      type: String,
      enum: ["WALLET", "PAYSTACK", "MONNIFY", "BANK_TRANSFER", "ADMIN_CREDIT"],
      default: "WALLET",
    },

    // 8. Ayax API & Gateway Responses (Raw Payload / Object)
    apiResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // 9. Automated & Manual Refund Audit Records
    isRefunded: {
      type: Boolean,
      default: false,
      index: true,
    },

    refundReason: {
      type: String,
      trim: true,
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
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// High-speed composite indexes for querying history and admin dashboards
TransactionSchema.index({ user: 1, createdAt: -1 });
TransactionSchema.index({ type: 1, status: 1, createdAt: -1 });
TransactionSchema.index({ status: 1, createdAt: -1 });
TransactionSchema.index({ reference: 1, user: 1 });
TransactionSchema.index({ phoneNumber: 1, type: 1 });
TransactionSchema.index({ meterNumber: 1, type: 1 });
TransactionSchema.index({ nin: 1, type: 1 });

module.exports =
  mongoose.models.Transaction ||
  mongoose.model("Transaction", TransactionSchema);