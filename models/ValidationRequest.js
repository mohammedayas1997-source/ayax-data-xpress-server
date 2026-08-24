const mongoose = require("mongoose");

const ValidationSchema = new mongoose.Schema(
  {
    // 1. Validation Category & Specific Service Mapping
    type: {
      type: String,
      required: [true, "Please specify the validation type"],
      trim: true,
      index: true,
    },

    service: {
      type: String,
      default: "NIN_VALIDATION",
      trim: true,
      index: true,
    },

    serviceId: {
      type: String,
      trim: true,
    },

    // 2. Identification Target Fields (NIN, Phone, BVN, or Tracking ID)
    nin: {
      type: String,
      trim: true,
      index: true,
    },

    searchValue: {
      type: String,
      trim: true,
      index: true,
    },

    // 3. Applicant Details for Admin Dashboard Identification
    applicantName: {
      type: String,
      trim: true,
    },

    applicantPhone: {
      type: String,
      trim: true,
    },

    additionalNote: {
      type: String,
      trim: true,
      default: "",
    },

    // 4. Flexible Container for Frontend Form Data / Dynamic Payloads
    formData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // 5. Financial & Transaction Ledgers
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

    // 6. Real-time Status Lifecycle
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "success", "rejected"],
      default: "pending",
      index: true,
    },

    // 7. Ayax VTU API Gateway Results & Slip Document Generation
    responseDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

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

    apiReference: {
      type: String,
      trim: true,
    },

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

    // 8. User Relational Link
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// High-performance composite indexes for query optimization
ValidationSchema.index({ userId: 1, createdAt: -1 });
ValidationSchema.index({ status: 1, createdAt: -1 });
ValidationSchema.index({ service: 1, status: 1 });
ValidationSchema.index({ nin: 1, status: 1 });
ValidationSchema.index({ reference: 1, userId: 1 });

module.exports =
  mongoose.models.ValidationRequest ||
  mongoose.model("ValidationRequest", ValidationSchema);