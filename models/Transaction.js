const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema(
  {
    // Mai amfani da ya yi ma'amalar
    user: {
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User",
      required: true,
      index: true, // Indexing don binciken tarihin kudi ya yi sauri sosai
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

    // Bayanan lamba ko wurin da aka tura sabis din (misali: Phone number, Meter Number, SmartCard Number)
    phoneNumber: {
      type: String,
      trim: true,
    },
    
    // Network ko Provider (Misali: MTN, GLO, DSTV, AEDC, Paystack, da sauransu)
    provider: {
      type: String,
      trim: true,
    },

    // Matsayin ma'amalar (status)
    status: {
      type: String,
      enum: ["pending", "success", "failed", "refunded", "processing"],
      default: "pending",
      index: true,
    },

    // Lambar reference ta kofa ko gateway (rigakafin double funding da duplicate requests)
    reference: {
      type: String,
      unique: true, 
      sparse: true,
      index: true,
    },

    // Karin bayani ko sakon da ya zo daga API/gateway (misali: "MTN 1GB to 0803...")
    details: {
      type: String,
      trim: true,
    },

    // Dalilin mayar da kudi (Refund reason) idan aka yi refund
    refundReason: { 
      type: String,
      trim: true,
    }, 

    // Ma'aikacin da ya amince ko ya aiwatar da transaction din (idan admin ne ya yi shi)
    requestedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User",
      index: true,
    },
  },
  {
    timestamps: true, // Yana samar da createdAt da updatedAt kai tsaye
  },
);

// Ingantattun Indexes domin saukin lissafi da loda tarihin ma'amala a Dashboard
TransactionSchema.index({ user: 1, createdAt: -1 });
TransactionSchema.index({ type: 1, status: 1, createdAt: -1 });
TransactionSchema.index({ reference: 1 });

module.exports = mongoose.model("Transaction", TransactionSchema);