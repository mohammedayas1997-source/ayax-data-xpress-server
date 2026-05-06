const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema(
  {
    surname: { type: String, required: [true, "Surname is required"] },
    firstName: { type: String, required: [true, "First name is required"] },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please provide a valid email address",
      ],
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
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
      default: "0000",
      select: false,
    },

    // PAYSTACK DEDICATED ACCOUNTS
    paystackCustomerCode: { type: String },
    bankName: { type: String },
    accountNumber: { type: String },
    accountName: { type: String },

    // ROLE MANAGEMENT (An kara 'superadmin' a nan)
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

    // RELATIONSHIPS (Hierarchical Structure)
    // Wanda ya kawo Agent (Supervisor ne)
    assignedSupervisor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Wanda ya kawo Supervisor (Leader ne)
    assignedLeader: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // TARGETS LOGIC
    targets: {
      agentGoal: { type: Number, default: 0 },
      dataGoal: { type: Number, default: 0 }, // Misali: 500GB
      supervisorGoal: { type: Number, default: 0 },
      currentMonth: { type: String },
    },

    isSuspended: { type: Boolean, default: false },
    address: { type: String },
  },
  {
    timestamps: true,
  },
);

// --- MIDDLEWARES (PASSWORD & PIN ENCRYPTION) ---

// Zamu hada su guri daya don code din ya fi kyau (Optimization)
UserSchema.pre("save", async function (next) {
  // Hash Password idan aka sauya shi
  if (this.isModified("password")) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  // Hash PIN idan aka sauya shi
  if (this.isModified("pin")) {
    const salt = await bcrypt.genSalt(10);
    this.pin = await bcrypt.hash(this.pin, salt);
  }

  next();
});

// --- METHODS ---

// Method don duba password
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Method don duba PIN (Transactions)
UserSchema.methods.matchPin = async function (enteredPin) {
  return await bcrypt.compare(enteredPin, this.pin);
};

// Rigakafi don kada wani ya sake gina model din (Dole ga Vercel)
module.exports = mongoose.models.User || mongoose.model("User", UserSchema);
