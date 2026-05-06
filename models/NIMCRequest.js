// models/NIMCRequest.js
const mongoose = require("mongoose");

const NIMCRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Haɗi da table ɗin User
      required: true,
    },
    serviceType: {
      type: String,
      required: [
        true,
        "Please specify the service type (e.g., Modification, Renewal)",
      ],
    },
    ninNumber: {
      type: String,
      required: [true, "NIN Number is required"],
    },
    formData: {
      type: Object, // Wannan zai adana dukkan sauran bayanan form ɗin a matsayin JSON
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "rejected"],
      default: "pending",
    },
    slipUrl: {
      type: String, // Anan za mu adana link ɗin hoton slip ɗin da Admin zai yi upload
      default: null,
    },
    resolvedAt: {
      type: Date,
    },
  },
  { timestamps: true }, // Zai samar da 'createdAt' da 'updatedAt' kai tsaye
);

module.exports = mongoose.model("NIMCRequest", NIMCRequestSchema);
