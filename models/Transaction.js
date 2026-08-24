const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema(
  {
    // Mai amfani da ya yi ma'amalar
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Lambar transaction ta musamman (Unique transaction ID)
    transactionId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    // Nau'in ma'amalar
    type: {
      type: String,
      enum: [
        "data",
        "airtime",
        "electricity",
        "cable",
        "wallet_funding",
        "utility",
        "deposit",
        "transfer",
        "refund",
      ],
      required: true,
      index: true,
    },

    // Adadin kudin ma'amalar (Amount a Naira)
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Balance din user kafin da bayan wannan transaction din (Audit Trail)
    oldBalance: {
      type: Number,
      default: 0,
    },
    newBalance: {
      type: Number,
      default: 0,
    },

    // Bayanan lamba ko wurin da aka tura sabis din (Phone, Meter, SmartCard)
    phoneNumber: {
      type: String,
      trim: true,
    },

    // Network ko Provider (Misali: MTN, GLO, AIRTEL, 9MOBILE, AYAX_GATEWAY)
    provider: {
      type: String,
      trim: true,
    },

    // Matsayin ma'amalar (status)
    status: {
      type: String,
      enum: ["pending", "processing", "success", "failed", "refunded"],
      default: "pending",
      index: true,
    },

    // Lambar reference ta kofa ko gateway (Ayax APIs / Paystack / Monnify)
    reference: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    // Karin bayani (misali: "MTN 1GB to 09033738409")
    details: {
      type: String,
      trim: true,
    },

    // Cikakkiyar amsar da ta dawo daga Ayax API Gateway / Network
    apiResponse: {
      type: String,
      trim: true,
    },

    // Bayanan mayar da kudi (Refund Information)
    refundReason: {
      type: String,
      trim: true,
    },
    refundedAt: {
      type: Date,
    },
    refundedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Ma'aikaci ko Admin da ya aiwatar da aikin da hannu (idan akwai)
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes domin saukin bincike da gaggawar loda tarihi a Dashboard
TransactionSchema.index({ user: 1, createdAt: -1 });
TransactionSchema.index({ type: 1, status: 1, createdAt: -1 });
TransactionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("Transaction", TransactionSchema);