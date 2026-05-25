const mongoose = require("mongoose");
const User = require("../models/User");
require("dotenv").config();

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("Connected to DB");

    const exists = await User.findOne({
      email: "supervisor@ayaxdata.online",
    });

    if (exists) {
      console.log("Supervisor already exists");
      process.exit();
    }

    const user = new User({
      firstName: "Supervisor",
      surname: "Ayax",
      name: "Supervisor Ayax",
      email: "supervisor@ayaxdata.online",
      phone: "08012345678",
      password: "Ayax2026",
      role: "supervisor",
      walletBalance: 0,
    });

    await user.save(); // 🔥 THIS WILL HASH PASSWORD AUTOMATICALLY

    console.log("Supervisor created successfully");
    process.exit();
  })
  .catch((err) => {
    console.log(err);
  });
