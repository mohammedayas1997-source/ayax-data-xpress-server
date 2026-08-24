const mongoose = require("mongoose");

const NIMCPriceSchema = new mongoose.Schema(
  {
    // 1. Service Identifier Key
    serviceId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true, // e.g. "nin", "phone", "trackingId", "standardSlip", "premiumCard", "basicSlip"
    },

    // 2. Service Category (Dynamic Enum matching app modules)
    serviceType: {
      type: String,
      required: true,
      trim: true,
      enum: [
        "nin",
        "phone",
        "trackingId",
        "standardSlip",
        "premiumCard",
        "basicSlip",
        "nin_verification",
        "nin_premium",
        "nin_search",
        "nimc_modification",
        "bvn_standard",
        "bvn_premium",
        "bvn_phone",
        "bvn_basic",
      ],
      index: true,
    },

    // 3. User-Friendly Display Title
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // 4. Pricing Configuration (Naira)
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
NIMCPriceSchema.index({ serviceId: 1, isActive: 1 });
NIMCPriceSchema.index({ serviceType: 1, isActive: 1 });

module.exports =
  mongoose.models.NIMCPrice || mongoose.model("NIMCPrice", NIMCPriceSchema);