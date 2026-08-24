require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const fixSuperAdmin = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error("? MONGO_URI is missing in .env");
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log("Connected to Database");

    const email = "mohammed.ayas@ayaxdata.online".toLowerCase().trim();
    const phone = "09033738409";
    const plainPassword = "Password123@";
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(plainPassword, salt);

    const usersCollection = mongoose.connection.db.collection("users");

    await usersCollection.deleteMany({
      $or: [{ email: email }, { phone: phone }],
    });

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
===================================================
? SUPERADMIN LOGIN DETAILS FIXED SUCCESSFULLY!
===================================================
Email:    ${email}
Phone:    ${phone}
Password: ${plainPassword}
Role:     superadmin
===================================================
    `);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("? Error fixing superadmin:", error);
    process.exit(1);
  }
};

fixSuperAdmin();
