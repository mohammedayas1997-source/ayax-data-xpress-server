const mongoose = require("mongoose");

const connectDB = async () => {
  // 1. Idan akwai connection (1 = connected, 2 = connecting), kar a sake bude wani
  if (mongoose.connection.readyState >= 1) {
    return;
  }

  try {
    // 2. GYARA: Mun daidaita sunan ya zama "MONGO_URI" daidai da yadda yake a Vercel dinka
    const dbUri = process.env.MONGO_URI;

    if (!dbUri) {
      console.error(
        "❌ ERROR: MONGO_URI is not defined in Vercel Environment Variables.",
      );
      return;
    }

    // 3. Bude alakar da Database
    const conn = await mongoose.connect(dbUri, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    throw error;
  }
};

module.exports = connectDB;
