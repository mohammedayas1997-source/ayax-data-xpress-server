const mongoose = require("mongoose");

const connectDB = async () => {
  // 1. Idan akwai connection riga da aka yi (1 = connected, 2 = connecting), kar a sake bude wani
  if (mongoose.connection.readyState >= 1) {
    return;
  }

  try {
    // 2. MUHIMMI: Mun sauya sunan daga MONGO_URI zuwa MONGODB_URI don ya dace da Vercel
    const dbUri = process.env.MONGODB_URI;

    if (!dbUri) {
      console.error(
        "❌ ERROR: MONGODB_URI is not defined in Vercel Environment Variables.",
      );
      return;
    }

    // 3. Bude alakar da Database
    const conn = await mongoose.connect(dbUri, {
      // Wadannan sune settings mafi kyau ga Vercel Serverless Functions
      serverSelectionTimeoutMS: 15000, // Kara lokaci zuwa sakan 15 don kaucewa timeout
      socketTimeoutMS: 45000,
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    // Muna jefa error din don server.js ya san cewa database bata hadu ba
    throw error;
  }
};

module.exports = connectDB;
