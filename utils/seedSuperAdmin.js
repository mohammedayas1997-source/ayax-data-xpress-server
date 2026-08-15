const mongoose = require("mongoose");
const User = require("../models/User");
const bcrypt = require("bcryptjs");

const fixSuperAdmin = async () => {
  try {
    const mongoURI = "mongodb+srv://mohammedayas102_db_user:Ayas1997@cluster0.vkv1jlq.mongodb.net/AyaxXpressDB?retryWrites=true&w=majority";

    await mongoose.connect(mongoURI);
    console.log("MongoDB Connected...");

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash("Password123!", salt);

    // Za mu sabunta ko kuma mu kirkira da karfin tsiya (Direct update)
    const result = await User.updateOne(
      { email: "mohammed.ayas@ayaxdata.online" },
      {
        $set: {
          surname: "Abdulrahman",
          firstName: "Ayas",
          name: "AYAX SUPERADMIN",
          password: hashedPassword,
          role: "superadmin",
          isSuspended: false,
          walletBalance: 0.0,
          pin: "8899",
          bankName: "Wema Bank"
        }
      },
      { upsert: true } // Idan babu shi zai kirkiro shi, idan akwai zai gyara shi
    );

    console.log("[Success] Superadmin account fixed directly in DB!", result);
    process.exit(0);
  } catch (error) {
    console.error("[Error] Fix failed:", error.message);
    process.exit(1);
  }
};

fixSuperAdmin();