const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    // 1. Direct Target Mapping (Supports both recipient & user aliases)
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      default: null,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      default: null,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // 2. Audience Segmentation & Scope
    target: {
      type: String,
      default: "all",
      index: true,
    },

    targetRole: {
      type: String,
      default: null,
    },

    targetUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // Geographic Target (State Manager & LGA Directives)
    state: {
      type: String,
      trim: true,
      default: null,
    },

    lga: {
      type: String,
      trim: true,
      default: null,
    },

    isBroadcast: {
      type: Boolean,
      default: false,
      index: true,
    },

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

    body: {
      type: String,
      trim: true,
    },

    // 4. Visual Category & Priority Coding (Expanded to allow all dynamic types)
    category: {
      type: String,
      default: "SYSTEM",
      index: true,
      uppercase: true,
      trim: true,
    },

    priority: {
      type: String,
      enum: ["LOW", "NORMAL", "HIGH", "URGENT"],
      default: "NORMAL",
      index: true,
    },

    type: {
      type: String,
      default: "info",
    },

    status: {
      type: String,
      enum: ["unread", "read", "pending", "sent", "archived"],
      default: "unread",
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

    read: {
      type: Boolean,
      default: false,
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
      index: { expireAfterSeconds: 0 },
      default: function () {
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

// High-speed compound indexes for live query execution
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ isActive: 1, target: 1, createdAt: -1 });
notificationSchema.index({ isBroadcast: 1, createdAt: -1 });
notificationSchema.index({ category: 1, priority: 1, createdAt: -1 });
notificationSchema.index({ "readBy.userId": 1, target: 1 });

module.exports =
  mongoose.models.Notification ||
  mongoose.model("Notification", notificationSchema);