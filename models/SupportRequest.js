const mongoose = require("mongoose");

const SupportRequestSchema = new mongoose.Schema(
  {
    // Lambar ma'amala ko transactionId da ake magana a kai
    transactionId: { 
      type: String, 
      required: true,
      trim: true,
      index: true,
    },

    // Mai amfani da ya mallaki transaction din ko ya fuskanci matsala
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true,
      index: true,
    },

    // Ma'aikacin da ya karɓi buƙatar ko ya buɗe/gudanar da ita (Support / Admin person)
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    }, 

    // Dalilin buƙatar (Misali: "Wrong transfer", "Data not delivered", "Failed airtime")
    reason: { 
      type: String, 
      required: true,
      trim: true,
    }, 

    // Karin bayani ko bayanin yadda aka warware matsalar (Support Note)
    supportNote: { 
      type: String,
      trim: true,
    },

    // Matsayin buƙatar (status)
    status: {
      type: String,
      enum: ["pending", "in_progress", "resolved", "rejected"],
      default: "pending",
      index: true,
    },

    // Lokacin da aka warware matsalar (Resolved date)
    resolvedAt: {
      type: Date,
    },
  },
  { 
    timestamps: true // Zai sarrafa 'createdAt' da 'updatedAt' kai tsaye 
  }
);

// Ingantattun Indexes domin saurin loda Support Dashboard da binciken korafi a cikin App
SupportRequestSchema.index({ userId: 1, createdAt: -1 });
SupportRequestSchema.index({ requestedBy: 1, createdAt: -1 });
SupportRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("SupportRequest", SupportRequestSchema);