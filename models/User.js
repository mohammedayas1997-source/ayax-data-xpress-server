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
    email: {
      type: String,
      required: [true, "Data Integrity Error: Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      // Gyaran Regex don karbar .online, .tech, da dukkan sabbin domains
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
      index: true,
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

    // --- PASSWORD RESET OTP ENTITIES ---
    resetPasswordToken: {
      type: String,
    },
    resetPasswordExpire: {
      type: Date,
    },

    // --- AUTOMATED PAYSTACK ENTITIES ---
    paystackCustomerCode: {
      type: String,
      index: true,
      unique: true,
      sparse: true,
    },
    bankName: { 
      type: String, 
      default: "Wema Bank" 
    },
    accountNumber: {
      type: String,
      index: true,
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
  index: true,
},

    // --- TOPOLOGICAL RELATIONSHIPS ---
    assignedSupervisor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
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
      index: true,
    },

    // --- GEOGRAPHIC & SYSTEM STATUS ---
    isSuspended: { 
      type: Boolean, 
      default: false,
      index: true,
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
  },
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

  // Ingantaccen duba don hana double-hashing (yana gane $2a$, $2b$, ko $2y$)
  if (this.isModified("password") && !this.password.startsWith("$2")) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  next();
});

// --- OPERATIONAL METHODS ---

UserSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

UserSchema.methods.matchPin = async function (enteredPin) {
  const pinHash = this.pin || this.transactionPin;
  if ((!pinHash || pinHash === "0000") && enteredPin === "0000") return true;
  if (!pinHash) return false;
  return await bcrypt.compare(enteredPin, pinHash);
};

UserSchema.index({ role: 1, isSuspended: 1 });
UserSchema.index({ assignedSupervisor: 1, role: 1 });

module.exports = mongoose.models.User || mongoose.model("User", UserSchema);