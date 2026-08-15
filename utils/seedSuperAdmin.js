const mongoose = require("mongoose");
const User = require("../models/User");
const bcrypt = require("bcryptjs");

const seedSuperAdmin = async () => {
  try {
    const mongoURI = "mongodb+srv://mohammedayas102_db_user:Ayas1997@cluster0.vkv1jlq.mongodb.net/AyaxXpressDB?retryWrites=true&w=majority";

    await mongoose.connect(mongoURI);
    console.log("MongoDB Connected for Seeding...");

    const superAdminEmail = "admin@ayaxdigital.solutions";

    // Cire tsohon mai amfani tukunna
    await User.deleteOne({ email: superAdminEmail });

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash("Password123!", salt);

    // Amfani da collection.insertOne kai tsaye don tsallake duk wani Schema validation error
    await User.collection.insertOne({
      surname: "SuperAdmin",
      firstName: "Ayax",
      otherName: "",
      name: "AYAX SUPERADMIN",
      email: superAdminEmail,
      phone: "09033738409",
      password: hashedPassword, 
      walletBalance: 0.0,
      pin: "0000",
      bankName: "Wema Bank",
      role: "superadmin",
      isSuspended: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    console.log(`[Success] Superadmin successfully forced into DB with email: ${superAdminEmail} and password: Password123!`);
    process.exit(0);

  } catch (error) {
    console.error("[Error] Seeding failed:", error.message);
    process.exit(1);
  }
};

seedSuperAdmin();