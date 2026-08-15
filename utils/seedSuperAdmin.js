const mongoose = require("mongoose");
const User = require("../models/User");

const seedSuperAdmin = async () => {
  try {
    // Ka saka ainihin link ɗinka a nan (cikin waɗannan alamomin dogon zance)
    const mongoURI = "mongodb+srv://mohammedayas102_db_user:Ayas1997@cluster0.vkv1jlq.mongodb.net/AyaxXpressDB?retryWrites=true&w=majority";

    await mongoose.connect(mongoURI);
    console.log("MongoDB Connected for Seeding...");

    const superAdminEmail = "admin@ayaxdigital.solutions";
    
    const existingAdmin = await User.findOne({ email: superAdminEmail });

    if (existingAdmin) {
      existingAdmin.role = "superadmin";
      await existingAdmin.save();
      console.log(`[Success] Existing user ${superAdminEmail} promoted to Superadmin.`);
      process.exit(0);
    }

    await User.collection.insertOne({
      surname: "SuperAdmin",
      firstName: "Ayax",
      otherName: "",
      name: "AYAX SUPERADMIN",
      email: superAdminEmail,
      phone: "09033738409",
      password: "$2a$12$TemporaryHashedPasswordPlaceholderToBypassValidation", 
      walletBalance: 0.0,
      pin: "0000",
      bankName: "Wema Bank",
      role: "superadmin",
      isSuspended: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    console.log(`[Success] Superadmin created successfully with email: ${superAdminEmail}`);
    process.exit(0);

  } catch (error) {
    console.error("[Error] Seeding failed:", error.message);
    process.exit(1);
  }
};

seedSuperAdmin();