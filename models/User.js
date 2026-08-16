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
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
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
    // Sanya tsohon balance don dacewa da duk wani controller da ke kiran .balance
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
        "leader",
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
    this.name = `${this.firstName} ${this.surname}`.toUpperCase().trim();
  }

  // Tabbatar da cewa balance da walletBalance sun kasance daidai ko da an canza daya daga ciki
  if (this.isModified("walletBalance")) {
    this.balance = this.walletBalance;
  } else if (this.isModified("balance")) {
    this.walletBalance = this.balance;
  }

  if (this.isModified("password")) {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
  }

  // Sarrafa pin da transactionPin tare
  if (this.isModified("pin") && this.pin !== "0000" && !this.pin.startsWith("$2a$")) {
    const salt = await bcrypt.genSalt(10);
    this.pin = await bcrypt.hash(this.pin, salt);
    this.transactionPin = this.pin;
  }

  if (this.isModified("transactionPin") && this.transactionPin && !this.transactionPin.startsWith("$2a$")) {
    const salt = await bcrypt.genSalt(10);
    this.transactionPin = await bcrypt.hash(this.transactionPin, salt);
    this.pin = this.transactionPin;
  }

  next();
});

// --- OPERATIONAL METHODS ---

UserSchema.methods.matchPassword = async function (enteredPassword) {
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