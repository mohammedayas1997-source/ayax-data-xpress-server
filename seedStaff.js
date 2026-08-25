require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/User");

const seedStaffAccounts = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error("? MONGO_URI is missing in .env");
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log("Connected to Database for Staff Seeding...");

    const defaultPassword = "Password123@";
    const defaultPin = "2026";

    const staffMembers = [
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

    for (const staff of staffMembers) {
      const cleanEmail = staff.email.toLowerCase().trim();
      const cleanPhone = staff.phone.trim();

      // Goge tsohon asusu
      await User.deleteMany({
        $or: [{ email: cleanEmail }, { phone: cleanPhone }],
      });

      // Zuba danyen password domin pre('save') hook din User.js ya yi hashing da kansa
      const newStaff = new User({
        ...staff,
        email: cleanEmail,
        phone: cleanPhone,
        password: defaultPassword,
        transactionPin: defaultPin,
        pin: defaultPin,
        isSuspended: false,
      });

      await newStaff.save();
    }

    console.log(`
===================================================
?? ALL STAFF ACCOUNTS CREATED SUCCESSFULLY!
===================================================
Default Password for all: ${defaultPassword}
Default PIN for all:      ${defaultPin}

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
    console.error("? Error seeding staff:", error);
    process.exit(1);
  }
};

seedStaffAccounts();
