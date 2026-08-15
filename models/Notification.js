const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    // Idan sanarwar tana zuwa ga takamaiman mutum daya ne (Personal Notification)
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    message: {
      type: String,
      required: true,
      trim: true,
    },

    // Rarraba kalar saƙo ko nau'in sanarwa (info, warning, success, danger, wallet, vtu, system)
    type: {
      type: String,
      enum: ["info", "warning", "success", "danger", "wallet", "vtu", "system"],
      default: "info",
      index: true,
    },

    // Wa kake son ya gani idan babban sako ne (Broadcast): "all", "agent", "supervisor", "user", "admin"
    target: {
      type: String,
      enum: ["all", "agent", "supervisor", "user", "admin"],
      default: "all",
      index: true,
    },

    // Ko mai amfani ya karanta sanarwar (Read status)
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Sanya ranar da saƙon zai daina nunawa ko kare wa (Expiration date)
    expiresAt: {
      type: Date,
      index: { expireAfterSeconds: 0 }, // Yana share tsofaffin sanarwa ta atomatik idan lokacinsu ya yi (TTL Index)
    },
  },
  {
    timestamps: true, // Yana samar da createdAt da updatedAt kai tsaye
  },
);

// Ingantattun Indexes domin App ɗin ya rinka loda notifications da sauri ga kowane mai amfani
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ isActive: 1, target: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);