const mongoose = require("mongoose");

const saleSchema = new mongoose.Schema(
  {
    // 1. Agent & Team Hierarchy Linkage
    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    supervisorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      index: true,
    },

    // 2. Product Category & Bundle Details
    serviceType: {
      type: String,
      enum: ["DATA", "AIRTIME", "ELECTRICITY", "CABLE", "NIN_SERVICE", "BVN_SERVICE"],
      default: "DATA",
      index: true,
    },

    planName: {
      type: String,
      required: true,
      trim: true,
    },

    network: {
      type: String,
      trim: true,
      index: true, // e.g. "MTN", "AIRTEL", "GLO", "9MOBILE"
    },

    planType: {
      type: String,
      trim: true, // e.g. "SME", "CORPORATE_GIFTING", "GIFTING", "DIRECT"
    },

    // 3. Quantitative & Financial Metrics (KPIs)
    dataAmountGB: {
      type: Number,
      default: 0,
      min: 0, // In Gigabytes for target/volume analytics
    },

    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },

    costPrice: {
      type: Number,
      default: 0,
      min: 0,
    },

    amount: {
      type: Number,
      required: true,
      min: 0, // Selling price charged to customer in Naira (₦)
    },

    profit: {
      type: Number,
      default: function () {
        return Math.max(0, (this.amount || 0) - (this.costPrice || 0));
      },
    },

    commissionEarned: {
      type: Number,
      default: 0,
      min: 0,
    },

    // 4. Beneficiary / Destination Information
    recipient: {
      type: String,
      trim: true,
      index: true, // Phone number, meter number, or NIN
    },

    // 5. Transaction Audit & External Identifiers
    reference: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    transactionRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      index: true,
    },

    // 6. Temporal Aggregation Keys (For Daily, Monthly & Yearly Aggregations)
    periodCode: {
      type: String,
      trim: true,
      index: true, // e.g. "2026-08"
    },

    dateString: {
      type: String,
      trim: true,
      index: true, // e.g. "2026-08-24"
    },

    // 7. Status & Settlement Lifecycle
    status: {
      type: String,
      enum: ["success", "failed", "refunded", "pending"],
      default: "success",
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Pre-save hook: Automatically generate temporal period codes and compute profit
saleSchema.pre("save", function (next) {
  const dateObj = this.createdAt || new Date();
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getDate()).padStart(2, "0");

  if (!this.periodCode) {
    this.periodCode = `${year}-${month}`;
  }

  if (!this.dateString) {
    this.dateString = `${year}-${month}-${day}`;
  }

  if (this.amount !== undefined && this.costPrice !== undefined) {
    this.profit = Math.max(0, this.amount - this.costPrice);
  }

  next();
});

// High-performance compound indexes for multi-level sales reporting & commission calculations
saleSchema.index({ supervisorId: 1, createdAt: -1 });
saleSchema.index({ agentId: 1, createdAt: -1 });
saleSchema.index({ agentId: 1, periodCode: 1, status: 1 });
saleSchema.index({ supervisorId: 1, periodCode: 1, status: 1 });
saleSchema.index({ serviceType: 1, status: 1, createdAt: -1 });
saleSchema.index({ createdAt: -1 });

module.exports =
  mongoose.models.Sale || mongoose.model("Sale", saleSchema);