const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema(
  {
    surname: {
      type: String,
      required: [true, "Data Integrity Error: Surname is required"],
      trim: true,
    },
    firstName: {
      type: String,
      required: [true, "Data Integrity Error: First name is required"],
      trim: true,
    },
    otherName: {
      type: String,
      trim: true,
      default: "",
    },
    name: {
      type: String,
      index: true,
    },

    // ✅ FIXED EMAIL VALIDATION (REAL-WORLD SAFE)
    email: {
      type: String,
      required: [true, "Data Integrity Error: Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      set: (v) => v?.toLowerCase().trim(),
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        "Protocol Error: Invalid email syntax provided",
      ],
    },

    phone: {
      type: String,
      required: [true, "Data Integrity Error: Phone number is required"],
      unique: true,
      trim: true,
    },

    password: {
      type: String,
      required: [true, "Security Error: Password hash is required"],
      minlength: 6,
      select: false,
    },

    walletBalance: {
      type: Number,
      default: 0.0,
      min: 0,
      set: (v) => Math.round(v * 100) / 100,
    },

    pin: {
      type: String,
      minlength: 4,
      maxlength: 64,
      default: "0000",
      select: false,
    },

    // --- PAYSTACK ---
    paystackCustomerCode: {
      type: String,
      index: true,
      unique: true,
      sparse: true,
    },
    bankName: { type: String, default: "Wema Bank" },
    accountNumber: {
      type: String,
      index: true,
      unique: true,
      sparse: true,
    },
    accountName: { type: String },

    // --- ROLES ---
    role: {
      type: String,
      enum: [
        "user",
        "agent",
        "supervisor",
        "leader",
        "admin",
        "superadmin",
        "support",
      ],
      default: "user",
    },

    // --- RELATIONSHIPS ---
    assignedSupervisor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    assignedLeader: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    referralId: {
      type: String,
      unique: true,
      sparse: true,
    },

    // --- STATUS ---
    isSuspended: { type: Boolean, default: false },
    state: { type: String },
    lga: { type: String },
    address: { type: String },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// =====================
// MIDDLEWARE
// =====================

UserSchema.pre("save", async function (next) {
  if (this.isModified("firstName") || this.isModified("surname")) {
    this.name = `${this.firstName} ${this.surname}`.toUpperCase().trim();
  }

  if (this.isModified("password")) {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
  }

  if (this.isModified("pin") && this.pin !== "0000") {
    const salt = await bcrypt.genSalt(10);
    this.pin = await bcrypt.hash(this.pin, salt);
  }

  next();
});

// =====================
// METHODS
// =====================

UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

UserSchema.methods.matchPin = async function (enteredPin) {
  if (this.pin === "0000" && enteredPin === "0000") return true;
  return await bcrypt.compare(enteredPin, this.pin);
};

module.exports = mongoose.models.User || mongoose.model("User", UserSchema);
