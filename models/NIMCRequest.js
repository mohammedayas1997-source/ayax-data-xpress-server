// models/NIMCRequest.js
const mongoose = require("mongoose");

const NIMCRequestSchema = new mongoose.Schema(
  {
    // 1. User Relational Association
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // 2. NIMC Service Classification
    serviceType: {
      type: String,
      required: [
        true,
        "Please specify the service type (e.g. Standard Slip, Premium Card, Modification, NIN Verification, Phone Search, Tracking ID Search)",
      ],
      trim: true,
      index: true,
    },

    serviceId: {
      type: String,
      trim: true,
      index: true,
    },

    // 3. Search & Identification Parameters
    ninNumber: {
      type: String,
      trim: true,
      index: true,
    },

    trackingId: {
      type: String,
      trim: true,
      index: true,
    },

    phoneNumber: {
      type: String,
      trim: true,
      index: true,
    },

    searchValue: {
      type: String,
      trim: true,
      index: true,
    },

    // 4. Form Data & Modification Payloads
    formData: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
      default: {},
    },

    // 5. Financial & Billing Audit
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

    reference: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    transactionId: {
      type: String,
      index: true,
      sparse: true,
    },

    // 6. Request Lifecycle & Status
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "rejected", "failed", "success"],
      default: "pending",
      index: true,
    },

    // 7. Verification Results & Printable Artifacts
    slipUrl: {
      type: String,
      trim: true,
      default: null,
    },

    pdfUrl: {
      type: String,
      trim: true,
      default: null,
    },

    photoUrl: {
      type: String,
      trim: true,
      default: null,
    },

    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // 8. Administrative Oversight & Notes
    adminComment: {
      type: String,
      trim: true,
      default: null,
    },

    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    resolvedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Lifecycle Hook: Set resolution timestamp upon completion or rejection
NIMCRequestSchema.pre("save", function (next) {
  if (
    this.isModified("status") &&
    ["completed", "success", "rejected", "failed"].includes(this.status.toLowerCase()) &&
    !this.resolvedAt
  ) {
    this.resolvedAt = new Date();
  }
  next();
});

// Optimized Compound Indexes for High-Traffic Queries
NIMCRequestSchema.index({ user: 1, createdAt: -1 });
NIMCRequestSchema.index({ status: 1, createdAt: -1 });
NIMCRequestSchema.index({ serviceType: 1, status: 1 });
NIMCRequestSchema.index({ ninNumber: 1, status: 1 });
NIMCRequestSchema.index({ trackingId: 1, status: 1 });
NIMCRequestSchema.index({ reference: 1, user: 1 });

module.exports =
  mongoose.models.NIMCRequest ||
  mongoose.model("NIMCRequest", NIMCRequestSchema);