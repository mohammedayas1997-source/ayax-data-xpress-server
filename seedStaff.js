require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
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
    
    // Hash password daya tak
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(defaultPassword, salt);

    const staffMembers = [
      {
        firstName: "Operations",
        surname: "Admin",
        name: "Operations Admin",
        email: "admin@ayaxdata.online",
        phone: "08011112222",
        role: "admin",
        walletBalance: 250000,
        balance: 250000,
      },
      {
        firstName: "Team",
        surname: "Leader",
        name: "National Team Leader",
        email: "leader@ayaxdata.online",
        phone: "08022223333",
        role: "leader",
        walletBalance: 150000,
        balance: 150000,
      },
      {
        firstName: "North",
        surname: "Supervisor",
        name: "North Regional Supervisor",
        email: "supervisor@ayaxdata.online",
        phone: "08033334444",
        role: "supervisor",
        walletBalance: 100000,
        balance: 100000,
      },
      {
        firstName: "Customer",
        surname: "Support",
        name: "Ayax HelpDesk",
        email: "support@ayaxdata.online",
        phone: "08077778888",
        role: "customer_service",
        walletBalance: 10000,
        balance: 10000,
      },
    ];

    for (const staff of staffMembers) {
      const cleanEmail = staff.email.toLowerCase().trim();
      const cleanPhone = staff.phone.trim();

      // Goge tsohon asusu idan akwai
      await User.deleteMany({
        $or: [{ email: cleanEmail }, { phone: cleanPhone }],
      });

      // Kirkiri sabo da Mongoose model tare da hashed password
      const newStaff = new User({
        ...staff,
        email: cleanEmail,
        phone: cleanPhone,
        password: hashedPassword,
        transactionPin: defaultPin,
        pin: defaultPin,
        status: "active",
        isSuspended: false,
        isVerified: true,
      });

      // Ajiye ba tare da pre-save hooks sun sake yi masa double-hash ba
      await newStaff.save({ validateBeforeSave: false });
    }

    console.log(`
===================================================
?? ALL STAFF ACCOUNTS CREATED & LOGIN FIXED!
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

4. CUSTOMER CARE:
   Phone: 08077778888 | Email: support@ayaxdata.online
   Role:  customer_service
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
