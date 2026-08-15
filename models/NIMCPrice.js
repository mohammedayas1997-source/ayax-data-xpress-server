const mongoose = require("mongoose");

const NIMCPriceSchema = new mongoose.Schema(
  {
    // Nau'in sabis din NIMC
    serviceType: {
      type: String,
      required: true,
      unique: true,
      enum: ["nin_verification", "nin_premium", "nin_search"], // Nau'ikan NIMC
      index: true,
    },

    // Farashin sabis din (Amount a Naira)
    amount: { 
      type: Number, 
      required: true,
      min: 0,
    },

    // Takaitaccen bayani game da sabis din (Optional)
    description: {
      type: String,
      trim: true,
    },

    // Wane Admin ne ya yi wannan sauyi a karshe
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true, // Yana sarrafa 'createdAt' da 'updatedAt' ta atomatik
  }
);

// Tabbatar cewa updatedAt yana samun sabuwar rana duk lokacin da aka yi save
NIMCPriceSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("NIMCPrice", NIMCPriceSchema);