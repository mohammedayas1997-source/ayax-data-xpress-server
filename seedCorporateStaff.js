require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const seedCorporateStaff = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error("? MONGO_URI is missing in .env");
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log("Connected to Database...");

    const defaultPassword = "Password123@";
    const defaultPin = "2026";
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(defaultPassword, salt);

    const usersCollection = mongoose.connection.db.collection("users");

    const corporateAccounts = [
      {
        firstName: "National",
        surname: "Director",
        name: "NATIONAL SALES DIRECTOR (NSD)",
        email: "nsd@ayaxdata.online",
        phone: "08099990000",
        role: "national_sales_director",
        walletBalance: 1000000,
        balance: 1000000,
      },
      {
        firstName: "Kano",
        surname: "Manager",
        name: "KANO STATE MANAGER (SM)",
        email: "kano.sm@ayaxdata.online",
        phone: "08022223333",
        role: "state_manager",
        state: "Kano",
        walletBalance: 250000,
        balance: 250000,
      },
      {
        firstName: "Nassarawa",
        surname: "Supervisor",
        name: "NASSARAWA LGA FIELD SUPERVISOR",
        email: "nassarawa.fs@ayaxdata.online",
        phone: "08033334444",
        role: "supervisor",
        state: "Kano",
        lga: "Nasarawa",
        walletBalance: 100000,
        balance: 100000,
      },
      {
        firstName: "Central",
        surname: "Retailer",
        name: "AYAX RETAIL AGENT 01",
        email: "agent01@ayaxdata.online",
        phone: "08055556666",
        role: "agent",
        state: "Kano",
        lga: "Nasarawa",
        walletBalance: 30000,
        balance: 30000,
      }
    ];

    for (const staff of corporateAccounts) {
      const email = staff.email.toLowerCase().trim();
      const phone = staff.phone.trim();

      await usersCollection.deleteMany({
        $or: [{ email: email }, { phone: phone }],
      });

      await usersCollection.insertOne({
        ...staff,
        email: email,
        phone: phone,
        password: hashedPassword,
        pin: defaultPin,
        transactionPin: defaultPin,
        isSuspended: false,
        isVerified: true,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    console.log(`
===================================================
?? CORPORATE TELECOM HIERARCHY INITIALIZED!
===================================================
Password for all: ${defaultPassword}
PIN for all:      ${defaultPin}

1. NATIONAL SALES DIRECTOR (NSD):
   Phone: 08099990000 | Email: nsd@ayaxdata.online
   Role:  national_sales_director

2. STATE MANAGER (SM):
   Phone: 08022223333 | Email: kano.sm@ayaxdata.online
   Role:  state_manager (Kano State)

3. FIELD SUPERVISOR (FS):
   Phone: 08033334444 | Email: nassarawa.fs@ayaxdata.online
   Role:  supervisor (Nasarawa LGA)

4. RETAIL AGENT:
   Phone: 08055556666 | Email: agent01@ayaxdata.online
   Role:  agent
===================================================
    `);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("? Corporate Seeding Error:", error);
    process.exit(1);
  }
};

seedCorporateStaff();
