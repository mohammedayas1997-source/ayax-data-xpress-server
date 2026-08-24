require("dotenv").config();
const mongoose = require("mongoose");

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;

async function updateAllBalances() {
  try {
    if (!mongoUri) {
      console.error("❌ No MONGODB_URI found in .env");
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log("Connected to Database...");

    const User = require("./models/User");

    // 1. Duba dukkan users
    const users = await User.find({});
    console.log(`Found ${users.length} users in database.`);

    // 2. Kara kudin kowa ya zama 5000
    const result = await User.updateMany(
      {},
      { 
        $set: { 
          walletBalance: 5000, 
          balance: 5000 
        } 
      }
    );

    console.log("✅ Successfully updated balances for all accounts:", result.modifiedCount);
  } catch (err) {
    console.error("Error updating balance:", err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

updateAllBalances();