const mongoose = require("mongoose");

const SupportRequestSchema = new mongoose.Schema(
  {
    // 1. Unique Ticket Identifier
    ticketId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    // 2. Transaction Association
    transactionId: {
      type: String,
      trim: true,
      index: true,
    },

    transactionReference: {
      type: String,
      trim: true,
      index: true,
    },

    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      index: true,
    },

    // 3. User & Staff Relations
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // 4. Ticket Classification & Priority
    category: {
      type: String,
      enum: [
        "DATA_DELIVERY",
        "AIRTIME_FAILED",
        "ELECTRICITY_TOKEN",
        "NIN_VERIFICATION",
        "BVN_ISSUE",
        "WALLET_FUNDING",
        "ACCOUNT_ISSUE",
        "GENERAL_INQUIRY",
      ],
      default: "GENERAL_INQUIRY",
      index: true,
    },

    priority: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
      default: "MEDIUM",
      index: true,
    },

    // 5. Issue Details & Communication
    reason: {
      type: String,
      required: [true, "Support request reason is required"],
      trim: true,
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    // Conversation thread between customer and admin
    messages: [
      {
        sender: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        senderRole: {
          type: String,
          enum: ["USER", "AGENT", "ADMIN", "SUPERADMIN"],
          default: "USER",
        },
        message: {
          type: String,
          required: true,
          trim: true,
        },
        attachmentUrl: {
          type: String,
          trim: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    supportNote: {
      type: String,
      trim: true,
      default: "",
    },

    // 6. Resolution & Status Lifecycle
    status: {
      type: String,
      enum: ["pending", "in_progress", "resolved", "rejected", "closed"],
      default: "pending",
      index: true,
    },

    resolutionAction: {
      type: String,
      enum: ["NONE", "WALLET_REFUNDED", "TOKEN_REISSUED", "MANUAL_DISPATCH", "INFO_PROVIDED"],
      default: "NONE",
    },

    refundAmount: {
      type: Number,
      min: 0,
      default: 0,
    },

    resolvedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Generate unique ticket identifier before creation
SupportRequestSchema.pre("save", function (next) {
  if (!this.ticketId) {
    this.ticketId = `TKT-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;
  }
  if (this.isModified("status") && (this.status === "resolved" || this.status === "closed") && !this.resolvedAt) {
    this.resolvedAt = new Date();
  }
  next();
});

// Composite indexes for fast query resolution and filter matrices
SupportRequestSchema.index({ userId: 1, createdAt: -1 });
SupportRequestSchema.index({ status: 1, priority: 1, createdAt: -1 });
SupportRequestSchema.index({ category: 1, status: 1 });
SupportRequestSchema.index({ transactionId: 1, userId: 1 });
SupportRequestSchema.index({ assignedTo: 1, status: 1 });

module.exports =
  mongoose.models.SupportRequest ||
  mongoose.model("SupportRequest", SupportRequestSchema);