const mongoose = require("mongoose");

const BVNPriceSchema = new mongoose.Schema(
  {
    // Nau'in sabis din BVN
    serviceType: {
      type: String,
      required: true,
      unique: true,
      enum: ["bvn_full", "bvn_basic", "bvn_face", "bvn_phone"], // Wadannan sune nau'ikan BVN din
      index: true,
    },

    // Farashin sabis din (Amount a Naira)
    amount: { 
      type: Number, 
      required: true, 
      min: 0 
    },

    // Bayani ko takaitaccen bayanin sabis din
    description: {
      type: String,
      trim: true,
    },

    // Wane Admin ne ya yi sauye-sauye a karshe (Optional)
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true, // Yana sarrafa 'createdAt' da 'updatedAt' ta atomatik
  }
);

// Idan ana so a tabbatar updatedAt yana sauyawa duk lokacin da aka yi updating
BVNPriceSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("BVNPrice", BVNPriceSchema);