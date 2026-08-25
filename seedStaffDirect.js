require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const seedStaffDirectly = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error("? MONGO_URI is missing in .env");
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log("Connected to Database...");

    const plainPassword = "Password123@";
    const defaultPin = "2026";
    
    // Hash password sau daya kacal
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(plainPassword, salt);

    const usersCollection = mongoose.connection.db.collection("users");

    const staffAccounts = [
      {
        firstName: "Operations",
        surname: "Admin",
        name: "OPERATIONS ADMIN",
        email: "admin@ayaxdata.online",
        phone: "08011112222",
        role: "admin",
        walletBalance: 250000,
        balance: 250000,
      },
      {
        firstName: "Team",
        surname: "Leader",
        name: "NATIONAL TEAM LEADER",
        email: "leader@ayaxdata.online",
        phone: "08022223333",
        role: "leader",
        walletBalance: 150000,
        balance: 150000,
      },
      {
        firstName: "North",
        surname: "Supervisor",
        name: "NORTH REGIONAL SUPERVISOR",
        email: "supervisor@ayaxdata.online",
        phone: "08033334444",
        role: "supervisor",
        walletBalance: 100000,
        balance: 100000,
      },
      {
        firstName: "Customer",
        surname: "Support",
        name: "AYAX HELPDESK",
        email: "support@ayaxdata.online",
        phone: "08077778888",
        role: "support",
        walletBalance: 10000,
        balance: 10000,
      },
    ];

    for (const staff of staffAccounts) {
      const email = staff.email.toLowerCase().trim();
      const phone = staff.phone.trim();

      // Goge tsohon asusun idan akwai
      await usersCollection.deleteMany({
        $or: [{ email: email }, { phone: phone }],
      });

      // Saka shi kai tsaye a cikin Native MongoDB Collection
      await usersCollection.insertOne({
        ...staff,
        email: email,
        phone: phone,
        password: hashedPassword,
        transactionPin: defaultPin,
        pin: defaultPin,
        isSuspended: false,
        isVerified: true,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    console.log(`
===================================================
? ALL STAFF INSERTED DIRECTLY INTO DATABASE!
===================================================
Password for all: ${plainPassword}
PIN for all:      ${defaultPin}

1. ADMIN:
   Phone: 08011112222 | Email: admin@ayaxdata.online
   Role:  admin

2. LEADER:
   Phone: 08022223333 | Email: leader@ayaxdata.online
   Role:  leader

3. SUPERVISOR:
   Phone: 08033334444 | Email: supervisor@ayaxdata.online
   Role:  supervisor

4. CUSTOMER SUPPORT:
   Phone: 08077778888 | Email: support@ayaxdata.online
   Role:  support
===================================================
    `);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("? Direct Seeding Error:", error);
    process.exit(1);
  }
};

seedStaffDirectly();
