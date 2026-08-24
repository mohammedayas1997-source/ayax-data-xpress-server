const mongoose = require("mongoose");

const BVNRequestSchema = new mongoose.Schema(
  {
    // 1. User Relational Association
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // 2. BVN Slip & Verification Service Classification
    serviceType: {
      type: String,
      required: true,
      default: "bvn_standard",
      enum: [
        "bvn_standard",
        "bvn_premium",
        "bvn_phone",
        "bvn_basic",
        "bvn_verification",
        "bvn_full",
        "bvn_face",
      ],
      index: true,
    },

    serviceId: {
      type: String,
      trim: true,
      index: true,
    },

    // 3. Search & Target Input Identifiers
    bvnNumber: {
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

    // 4. Financial & Audit Breakdown
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

    // 5. Lifecycle & Processing Status
    status: {
      type: String,
      required: true,
      default: "pending",
      enum: ["pending", "processing", "success", "completed", "failed", "rejected"],
      index: true,
    },

    // 6. Printable Slip Artifacts & Gateway Results
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

    // 7. Administrative Oversight & Notes
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
BVNRequestSchema.pre("save", function (next) {
  if (
    this.isModified("status") &&
    ["completed", "success", "rejected", "failed"].includes(this.status.toLowerCase()) &&
    !this.resolvedAt
  ) {
    this.resolvedAt = new Date();
  }
  next();
});

// High-performance compound indexes for history and administration
BVNRequestSchema.index({ user: 1, createdAt: -1 });
BVNRequestSchema.index({ status: 1, createdAt: -1 });
BVNRequestSchema.index({ serviceType: 1, status: 1 });
BVNRequestSchema.index({ bvnNumber: 1, status: 1 });
BVNRequestSchema.index({ reference: 1, user: 1 });

module.exports =
  mongoose.models.BVNRequest ||
  mongoose.model("BVNRequest", BVNRequestSchema);