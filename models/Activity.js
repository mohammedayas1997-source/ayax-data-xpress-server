const mongoose = require("mongoose");

const ActivitySchema = new mongoose.Schema(
  {
    // User din da ya yi aikin (Staff, Admin, ko Agent)
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Wane irin aiki aka yi? (misali: "LOGIN", "REFUND_REQUEST", "CHANGE_ROLE")
    action: {
      type: String,
      required: true,
      index: true, // Mun saka index domin bincike ya yi sauri (Optimization)
    },

    // Karin bayani (misali: "Changed Agent Musa's role to Supervisor")
    details: {
      type: String,
    },

    // User din da abin ya shafa (idan akwai)
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Tsaro: Daga wane IP address aikin ya fito?
    ipAddress: {
      type: String,
    },

    // Browser ko App din da aka yi amfani da shi
    userAgent: {
      type: String,
    },
  },
  {
    timestamps: true, // Wannan zai baka 'createdAt' da 'updatedAt' kai tsaye
  },
);

// Indexing don saurin loda Dashboard
ActivitySchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Activity", ActivitySchema);
