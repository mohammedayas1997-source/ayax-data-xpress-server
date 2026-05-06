const mongoose = require("mongoose");

const connectDB = async () => {
  // 1. Idan har akwai connection (1 = connected, 2 = connecting), kar a sake bude wani
  if (mongoose.connection.readyState >= 1) {
    return;
  }

  try {
    // 2. Tabbatar da MONGO_URI yana nan
    if (!process.env.MONGO_URI) {
      console.error("MONGO_URI is not defined in environment variables");
      return;
    }

    const conn = await mongoose.connect(process.env.MONGO_URI, {
      // Wadannan options din sun dace da Mongoose 6+
      serverSelectionTimeoutMS: 10000, // Na kara zuwa sakan 10 don Vercel ya samu lokaci
      socketTimeoutMS: 45000,
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`MongoDB Connection Error: ${error.message}`);
    // A Vercel, kar mu kira process.exit(1) domin zai kashe function din gaba daya
    // Mun bar shi ya yi throw don server.js ya sani
    throw error;
  }
};

module.exports = connectDB;
