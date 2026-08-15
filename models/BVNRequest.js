const mongoose = require("mongoose");

const BVNRequestSchema = new mongoose.Schema(
  {
    // Mai amfani da ya yi buƙatar BVN Verification
    user: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true,
      index: true,
    },

    // Nau'in sabis din BVN (misali: bvn_full, bvn_basic, bvn_face, bvn_phone, ko bvn_verification)
    serviceType: { 
      type: String, 
      required: true,
      default: "bvn_verification",
      enum: ["bvn_verification", "bvn_full", "bvn_basic", "bvn_face", "bvn_phone"],
      index: true,
    },

    // Lambar BVN da aka bincika
    bvnNumber: { 
      type: String, 
      required: true,
      trim: true,
      index: true,
    },

    // Adadin kudin da aka cire
    amount: { 
      type: Number, 
      required: true,
      min: 0,
    },

    // Matsayin buƙatar (status)
    status: { 
      type: String, 
      required: true,
      default: "completed",
      enum: ["pending", "success", "completed", "failed"],
      index: true,
    },

    // Cikakken sakamakon da ya fito daga API (misali: Dojah ko wani gateway)
    details: { 
      type: mongoose.Schema.Types.Mixed, 
      default: {},
    },

    // Lambar reference ta ma'amala (Transaction reference)
    reference: { 
      type: String,
      unique: true,
      sparse: true, // Yana ba da damar zama unique idan akwai amma ba zai bada error ba idan babu
      index: true,
    },
  },
  {
    timestamps: true, // Yana sarrafa 'createdAt' da 'updatedAt' ta atomatik
  }
);

// Ingantattun Indexes don saurin bincike a cikin tarihin binciken BVN
BVNRequestSchema.index({ user: 1, createdAt: -1 });
BVNRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("BVNRequest", BVNRequestSchema);