const mongoose = require("mongoose");

const ActivitySchema = new mongoose.Schema(
  {
    // 1. Actor Performing Action (User, Staff, Agent, or Admin)
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      default: function () {
        return this.user;
      },
    },

    actorRole: {
      type: String,
      enum: ["USER", "AGENT", "SUPERVISOR", "ADMIN", "SUPERADMIN", "SYSTEM"],
      default: "USER",
      index: true,
    },

    // 2. Action Key Classification
    action: {
      type: String,
      required: true,
      trim: true,
      index: true, // e.g. "AUTH_LOGIN", "DATA_PURCHASE", "REFUND_ISSUED", "WALLET_CREDITED", "NIMC_VERIFY", "ROLE_UPDATED"
    },

    category: {
      type: String,
      enum: ["AUTH", "FINANCIAL", "VTU", "IDENTITY", "ADMIN_CONTROL", "SECURITY", "SYSTEM"],
      default: "SYSTEM",
      index: true,
    },

    // 3. Human-Readable Description & Metadata
    details: {
      type: String,
      required: true,
      trim: true,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // 4. Target Affected Entity
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      default: null,
    },

    targetReference: {
      type: String,
      trim: true,
      index: true,
      default: null,
    },

    // 5. Security & Device Footprint
    ipAddress: {
      type: String,
      trim: true,
      default: "0.0.0.0",
    },

    userAgent: {
      type: String,
      trim: true,
      default: "Unknown",
    },

    deviceType: {
      type: String,
      enum: ["MOBILE_APP", "WEB_PORTAL", "API_REQUEST", "ADMIN_PANEL"],
      default: "MOBILE_APP",
    },

    // 6. Execution Outcome
    status: {
      type: String,
      enum: ["SUCCESS", "FAILED", "WARNING", "BLOCKED"],
      default: "SUCCESS",
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Pre-save synchronization for user and staffId
ActivitySchema.pre("save", function (next) {
  if (!this.staffId && this.user) {
    this.staffId = this.user;
  }
  next();
});

// High-performance composite indexes for real-time audit logging and forensics
ActivitySchema.index({ user: 1, createdAt: -1 });
ActivitySchema.index({ staffId: 1, createdAt: -1 });
ActivitySchema.index({ action: 1, createdAt: -1 });
ActivitySchema.index({ category: 1, createdAt: -1 });
ActivitySchema.index({ targetUser: 1, createdAt: -1 });

module.exports =
  mongoose.models.Activity || mongoose.model("Activity", ActivitySchema);