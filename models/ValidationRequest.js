const mongoose = require("mongoose");

const ValidationSchema = new mongoose.Schema(
  {
    // Nau'in bincike ko tabbatarwa (Misali: 'SIM Validation', 'NIN Verification', 'BVN Check')
    type: { 
      type: String, 
      required: [true, "Please specify the validation type"], 
      trim: true,
      index: true,
    },

    // Lambar NIN ko bayanin da ake son a bincika
    nin: { 
      type: String, 
      required: [true, "NIN or Identification number is required"],
      trim: true,
      index: true,
    },

    // Karin bayanai ko form data da ake bukata domin aikin binciken (Optional / Mixed)
    formData: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Adadin kudin da aka cire don wannan sabis ɗin
    amount: { 
      type: Number, 
      required: true,
      min: 0,
    },

    // Matsayin buƙatar (status)
    status: { 
      type: String, 
      enum: ["pending", "processing", "completed", "failed", "success"],
      default: "pending",
      index: true,
    },

    // Sakamakon binciken daga API ko bayanin da aka dawo da shi
    responseDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Lambar Transaction ID ko Reference domin daidaita kudi da ma'amala
    transactionId: {
      type: String,
      index: true,
      sparse: true,
    },

    reference: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    // Mai amfani da ya yi buƙatar
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User",
      required: true,
      index: true,
    },
  },
  { 
    timestamps: true // Zai samar da 'createdAt' da 'updatedAt' ta atomatik
  }
);

// Ingantattun Indexes domin saurin loda Validation History da binciken Dashboard
ValidationSchema.index({ userId: 1, createdAt: -1 });
ValidationSchema.index({ status: 1, createdAt: -1 });
ValidationSchema.index({ type: 1, status: 1 });

module.exports = mongoose.model("ValidationRequest", ValidationSchema);