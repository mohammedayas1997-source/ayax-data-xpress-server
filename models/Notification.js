const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    // 1. Direct Target Mapping (Null if Global Broadcast)
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      default: null,
    },

    // 2. Audience Segmentation & Scope
    target: {
      type: String,
      enum: ["all", "user", "agent", "supervisor", "admin", "superadmin", "specific_users"],
      default: "all",
      index: true,
    },

    targetUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // 3. Header & Content
    title: {
      type: String,
      required: [true, "Notification title is required"],
      trim: true,
    },

    message: {
      type: String,
      required: [true, "Notification body message is required"],
      trim: true,
    },

    // 4. Visual Category & Priority Coding
    category: {
      type: String,
      enum: [
        "ACCOUNT",
        "CREDIT",
        "DEBIT",
        "REFUND",
        "VTU_DISPATCH",
        "ELECTRICITY_TOKEN",
        "NIN_SERVICE",
        "BVN_SERVICE",
        "ADMIN_BROADCAST",
        "SUPPORT",
        "SYSTEM",
      ],
      default: "SYSTEM",
      index: true,
    },

    priority: {
      type: String,
      enum: ["LOW", "NORMAL", "HIGH", "URGENT"],
      default: "NORMAL",
      index: true,
    },

    type: {
      type: String,
      enum: ["info", "warning", "success", "danger", "wallet", "vtu", "system"],
      default: "info",
    },

    // 5. In-App Navigation Action Routing
    actionRoute: {
      type: String,
      trim: true,
      default: null, // e.g. "Wallet History", "FundWallet", "NIMC"
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // 6. Direct User Read Status
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },

    readAt: {
      type: Date,
      default: null,
    },

    // Tracking read receipts for global broadcasts
    readBy: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        readAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // 7. Lifecycle & TTL Expiry
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    expiresAt: {
      type: Date,
      index: { expireAfterSeconds: 0 }, // Automatic cleanup via MongoDB TTL index
      default: function () {
        // Auto cleanup after 90 days if not specified
        return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// High-speed compound indexes for query execution
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ isActive: 1, target: 1, createdAt: -1 });
notificationSchema.index({ category: 1, priority: 1, createdAt: -1 });
notificationSchema.index({ "readBy.userId": 1, target: 1 });

module.exports =
  mongoose.models.Notification ||
  mongoose.model("Notification", notificationSchema);