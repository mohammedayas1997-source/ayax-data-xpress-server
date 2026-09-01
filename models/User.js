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
    },
    email: {
      type: String,
      required: [true, "Data Integrity Error: Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,10})+$/,
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
    balance: {
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
    transactionPin: {
      type: String,
      minlength: 4,
      maxlength: 64,
      select: false,
    },

    // --- SECURITY & BRUTE-FORCE LOCKOUT ---
    failedPinAttempts: {
      type: Number,
      default: 0,
    },
    pinLockedUntil: {
      type: Date,
    },

    // --- PASSWORD RESET ENTITIES ---
    resetPasswordToken: {
      type: String,
    },
    resetPasswordLinkToken: {
      type: String,
    },
    resetPasswordExpire: {
      type: Date,
    },

    // --- AUTOMATED PAYSTACK ENTITIES ---
    paystackCustomerCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    bankName: {
      type: String,
      default: "Wema Bank",
    },
    accountNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    accountName: {
      type: String,
      trim: true,
    },

    // --- ACCESS HIERARCHY ---
    role: {
      type: String,
      enum: [
        "user",
        "agent",
        "supervisor",
        "field_supervisor",
        "state_manager",
        "leader",
        "national_sales_director",
        "super_leader",
        "admin",
        "superadmin",
        "support",
      ],
      default: "user",
    },

    // --- TOPOLOGICAL RELATIONSHIPS & REFERRALS ---
    assignedSupervisor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    assignedSupervisorName: {
      type: String,
      trim: true,
    },
    assignedLeader: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    referralId: {
      type: String,
      unique: true,
      sparse: true,
    },
    referralCode: {
      type: String,
      trim: true,
      index: true,
    },
    referredBy: {
      type: String,
      trim: true,
      index: true,
    },
    supervisorId: {
      type: String,
      trim: true,
      index: true,
    },

    // --- IN-APP NOTIFICATIONS LEDGER ---
    notifications: [
      {
        title: { type: String, required: true },
        message: { type: String, required: true },
        category: { type: String, default: "GENERAL" },
        date: { type: Date, default: Date.now },
        createdAt: { type: Date, default: Date.now },
        isRead: { type: Boolean, default: false },
        read: { type: Boolean, default: false },
      },
    ],

    // --- TARGET & QUOTA TRACKING ENTITIES ---
    targets: {
      dataGoal: { type: Number, default: 0 },
      airtimeGoal: { type: Number, default: 0 },
      agentGoal: { type: Number, default: 10 },
      supervisorGoal: { type: Number, default: 10 },
      currentMonth: { type: String, default: "August 2026" },
      assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      assignedByLeader: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      state: { type: String },
      lga: { type: String },
    },
    dataGoal: { type: Number, default: 0 },
    airtimeGoal: { type: Number, default: 0 },
    agentGoal: { type: Number, default: 10 },
    dataSold: { type: Number, default: 0 },
    dataVolumeSold: { type: Number, default: 0 },
    airtimeSold: { type: Number, default: 0 },

    // --- GEOGRAPHIC & SYSTEM STATUS ---
    isSuspended: {
      type: Boolean,
      default: false,
    },
    isVerified: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      default: "active",
    },
    state: {
      type: String,
      trim: true,
    },
    lga: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// --- PROTOCOL MIDDLEWARES ---

UserSchema.pre("save", async function (next) {
  if (this.isModified("firstName") || this.isModified("surname")) {
    this.name = `${this.firstName || ""} ${this.surname || ""}`.toUpperCase().trim();
  }

  // Tabbatar da cewa balance da walletBalance sun kasance daidai
  if (this.isModified("walletBalance")) {
    this.balance = this.walletBalance;
  } else if (this.isModified("balance")) {
    this.walletBalance = this.balance;
  }

  // Password Hashing
  if (this.isModified("password") && !this.password.startsWith("$2")) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  // PIN Hashing
  if (this.isModified("transactionPin") && this.transactionPin && !this.transactionPin.startsWith("$2")) {
    const salt = await bcrypt.genSalt(10);
    this.transactionPin = await bcrypt.hash(this.transactionPin, salt);
  }

  if (this.isModified("pin") && this.pin && !this.pin.startsWith("$2")) {
    if (this.pin !== "0000") {
      const salt = await bcrypt.genSalt(10);
      this.pin = await bcrypt.hash(this.pin, salt);
    }
  }

  next();
});

// --- OPERATIONAL METHODS ---

UserSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

UserSchema.methods.matchPin = async function (enteredPin) {
  const pinHash = this.transactionPin || this.pin;
  if ((!pinHash || pinHash === "0000") && enteredPin === "0000") return true;
  if (!pinHash) return false;
  
  if (!pinHash.startsWith("$2")) {
    return pinHash === enteredPin;
  }
  
  return await bcrypt.compare(enteredPin, pinHash);
};

// --- OPTIMIZED COMPOUND INDEXES ---
UserSchema.index({ role: 1, isSuspended: 1 });
UserSchema.index({ assignedSupervisor: 1, role: 1 });
UserSchema.index({ state: 1, lga: 1 });

module.exports = mongoose.models.User || mongoose.model("User", UserSchema);