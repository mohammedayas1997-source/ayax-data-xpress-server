const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema(
  {
    surname: {
      type: String,
      required: [true, "Surname is required"],
      trim: true,
    },
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
    },
    name: {
      type: String, // Full name for easy retrieval in Paystack/Receipts
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please provide a valid email address",
      ],
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false,
    },
    walletBalance: {
      type: Number,
      default: 0.0,
      min: [0, "Wallet balance cannot be negative"],
    },
    pin: {
      type: String,
      minlength: 4,
      maxlength: 4,
      default: "0000", // Default pin for new users
      select: false,
    },

    // --- PAYSTACK DEDICATED ACCOUNTS DATA ---
    paystackCustomerCode: { type: String, index: true },
    bankName: { type: String },
    accountNumber: { type: String, index: true },
    accountName: { type: String },

    // --- ROLE MANAGEMENT (Scalable Roles) ---
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

    // --- HIERARCHICAL RELATIONSHIPS ---
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

    // --- TARGETS & PERFORMANCE LOGIC ---
    targets: {
      agentGoal: { type: Number, default: 0 },
      dataGoal: { type: Number, default: 0 }, // Goal in GB
      supervisorGoal: { type: Number, default: 0 },
      currentMonth: { type: String },
    },

    // --- STATUS & LOCATION ---
    isSuspended: { type: Boolean, default: false },
    state: { type: String },
    lga: { type: String },
    address: { type: String },

    // Recovery Token for Password reset
    resetPasswordToken: String,
    resetPasswordExpire: Date,
  },
  {
    timestamps: true, // Automatically manages createdAt and updatedAt
  },
);

// --- MIDDLEWARES ---

// Pre-save hook: Hash password, PIN, and set Full Name
UserSchema.pre("save", async function (next) {
  // 1. Generate Full Name automatically
  if (this.isModified("firstName") || this.isModified("surname")) {
    this.name = `${this.firstName} ${this.surname}`.trim();
  }

  // 2. Hash Password
  if (this.isModified("password")) {
    const salt = await bcrypt.genSalt(12); // Higher salt for better security
    this.password = await bcrypt.hash(this.password, salt);
  }

  // 3. Hash PIN (Only if it's not the default "0000" or if it's being updated)
  if (this.isModified("pin")) {
    const salt = await bcrypt.genSalt(10);
    this.pin = await bcrypt.hash(this.pin, salt);
  }

  next();
});

// --- INSTANCE METHODS ---

// Verify Password
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Verify PIN
UserSchema.methods.matchPin = async function (enteredPin) {
  return await bcrypt.compare(enteredPin, this.pin);
};

// Prevent Re-compilation of model (Critical for Vercel/Serverless)
module.exports = mongoose.models.User || mongoose.model("User", UserSchema);
