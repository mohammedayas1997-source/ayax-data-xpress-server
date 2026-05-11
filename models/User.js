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
    name: { type: String }, // Full name for easy retrieval
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
      minlength: 6,
      select: false,
    },
    walletBalance: { type: Number, default: 0.0, min: 0 },
    pin: {
      type: String,
      minlength: 4,
      maxlength: 4,
      default: "0000",
      select: false, // Karka cire wannan, don tsaro
    },

    // --- PAYSTACK DATA ---
    paystackCustomerCode: { type: String, index: true },
    bankName: { type: String },
    accountNumber: { type: String, index: true },
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

    // --- STATUS ---
    isSuspended: { type: Boolean, default: false },
    state: { type: String },
    lga: { type: String },
    address: { type: String },
  },
  { timestamps: true },
);

// --- MIDDLEWARES ---

UserSchema.pre("save", async function (next) {
  // 1. Saita Cikakken Suna
  if (this.isModified("firstName") || this.isModified("surname")) {
    this.name = `${this.firstName} ${this.surname}`.trim();
  }

  // 2. Hash Password (idan an canza shi)
  if (this.isModified("password")) {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
  }

  // 3. MUHIMMI: Hash PIN (Kada kayi hash idan "0000" ne na farko domin saukin login)
  // Idan mutum ya canza PIN daga "0000" zuwa wani abu, to anan ne za'ayi hashing
  if (this.isModified("pin") && this.pin !== "0000") {
    const salt = await bcrypt.genSalt(10);
    this.pin = await bcrypt.hash(this.pin, salt);
  }

  next();
});

// --- METHODS ---

// Duba Password
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Duba PIN
UserSchema.methods.matchPin = async function (enteredPin) {
  // Idan har yanzu PIN din "0000" ne kuma ba'ayi hashing ba
  if (this.pin === "0000" && enteredPin === "0000") return true;
  return await bcrypt.compare(enteredPin, this.pin);
};

module.exports = mongoose.models.User || mongoose.model("User", UserSchema);
