const mongoose = require("mongoose");

const BVNPriceSchema = new mongoose.Schema(
  {
    // 1. Service Identifier Key (Matching frontend keys)
    serviceId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true, // e.g. "bvn_standard", "bvn_premium", "bvn_phone", "bvn_basic"
    },

    // 2. Service Classification & Types
    serviceType: {
      type: String,
      required: true,
      trim: true,
      enum: [
        "bvn_standard",
        "bvn_premium",
        "bvn_phone",
        "bvn_basic",
        "bvn_full",
        "bvn_face",
        "bvn_verification",
      ],
      index: true,
    },

    // 3. User-Friendly Display Title
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // 4. Multi-Tier Pricing Matrix (Naira)
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    agentPrice: {
      type: Number,
      min: 0,
      default: function () {
        return this.amount;
      },
    },

    costPrice: {
      type: Number,
      min: 0,
      default: 0,
    },

    // 5. Service Status & Metadata
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    // 6. Administrative Audit Trail
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// High-speed index for rapid checkout & pricing retrieval
BVNPriceSchema.index({ serviceId: 1, isActive: 1 });
BVNPriceSchema.index({ serviceType: 1, isActive: 1 });

module.exports =
  mongoose.models.BVNPrice || mongoose.model("BVNPrice", BVNPriceSchema);