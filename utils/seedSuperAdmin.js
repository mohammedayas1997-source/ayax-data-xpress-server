require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const seedSuperAdmin = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error("❌ MONGO_URI is missing in .env");
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log("Connected to Database");

    const email = "mohammed.ayas@ayaxdata.online".toLowerCase().trim();
    const phone = "09033738409";
    const defaultPassword = "Password123@";
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    const usersCollection = mongoose.connection.db.collection("users");

    // 1. Share duk wani tsohon account da ke dauke da wannan email ko lambar waya
    await usersCollection.deleteMany({
      $or: [{ email: email }, { phone: phone }],
    });
    console.log(" Cleaned up any old conflicting user records.");

    // 2. Saka Superadmin kai tsaye
    await usersCollection.insertOne({
      firstName: "Mohammed",
      surname: "Ayas",
      name: "Mohammed Ayas",
      email: email,
      phone: phone,
      password: hashedPassword,
      role: "superadmin",
      status: "active",
      walletBalance: 1000000,
      balance: 1000000,
      transactionPin: "1997",
      pin: "1997",
      isVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(`
=========================================
✅ SUPERADMIN CREATED SUCCESSFULLY!
Email: ${email}
Phone: ${phone}
Password: ${defaultPassword}
Role: superadmin
=========================================
    `);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding superadmin:", error);
    process.exit(1);
  }
};

seedSuperAdmin();