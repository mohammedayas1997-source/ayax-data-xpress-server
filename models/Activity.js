const mongoose = require("mongoose");

const ActivitySchema = new mongoose.Schema(
  {
    // User din da ya yi aikin (Staff, Admin, ko Agent)
    // Mun ba da damar a yi amfani da 'user' ko 'staffId' a cikin code don guje wa matsala
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Don tallafawa duk wani controller da ke amfani da 'staffId' maimakon 'user'
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    // Wane irin aiki aka yi? (misali: "LOGIN", "REFUND_REQUEST", "CHANGE_ROLE", "BUY_DATA")
    action: {
      type: String,
      required: true,
      index: true, // Index don saurin bincike (Optimization)
    },

    // Karin bayani game da aikin da aka yi
    details: {
      type: String,
      required: true,
    },

    // User din da abin ya shafa ko aikin ya zo a kan sa (idan akwai)
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
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
    timestamps: true, // Yana samar da 'createdAt' da 'updatedAt' ta atomatik
  },
);

// Ingantattun Indexes don saurin loda Audit Logs da Dashboards
ActivitySchema.index({ user: 1, createdAt: -1 });
ActivitySchema.index({ staffId: 1, createdAt: -1 });
ActivitySchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model("Activity", ActivitySchema);