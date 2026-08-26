require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const fixUser = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    await mongoose.connect(mongoUri);

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash("Ayax@2026", salt);

    const result = await mongoose.connection.db.collection("users").updateOne(
      { email: "leader@ayaxdata.online" },
      {
        $set: {
          password: hashedPassword,
          isSuspended: false,
          isVerified: true,
          status: "active",
        },
      }
    );

    console.log("? An gyara asusun leader@ayaxdata.online cikin nasara!");
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("? Error:", err);
    process.exit(1);
  }
};

fixUser();
