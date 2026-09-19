const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
require("dotenv").config();

// Sanya Model na User
const User = require("./models/User");

const resetKanoUsers = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB...");

    // Password na bai-daya da za a saita musu na wucin gadi
    const tempPassword = "Password123@";
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(tempPassword, salt);

    // Nemo dukkan masu amfani da ke jihar Kano (ko ta yaya aka rubuta sunan jihar)
    const result = await User.updateMany(
      { state: { $regex: /^kano$/i } },
      { 
        $set: { 
          password: hashedPassword,
          isSuspended: false,
          status: "active"
        } 
      }
    );

    console.log(`An yi nasarar saita wa asusun mutum ${result.modifiedCount} na jihar Kano sabon password!`);
    console.log(`Yanzu kowa a Kano zai iya shiga da: ${tempPassword}`);
    
    process.exit(0);
  } catch (error) {
    console.error("Kuskure wajen saita password:", error.message);
    process.exit(1);
  }
};

resetKanoUsers();