const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
    },
    // Rarraba kalar saƙo (Blue, Yellow, Green, Red)
    type: {
      type: String,
      enum: ["info", "warning", "success", "danger"],
      default: "info",
    },
    // Wa kake son ya gani? (Kowa, Agents kawai, ko Supervisors)
    target: {
      type: String,
      enum: ["all", "agent", "supervisor", "user"],
      default: "all",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Sanya ranar da saƙon zai daina nunawa
    expiresAt: {
      type: Date,
    },
  },
  {
    timestamps: true, // Wannan zai baka createdAt da updatedAt
  },
);

// Indexing domin App ɗin ya rinka loda notifications da sauri
notificationSchema.index({ isActive: 1, target: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
