const mongoose = require("mongoose");
require("dotenv").config();

const deleteDirect = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    const conn = await mongoose.connect(mongoUri);
    console.log("An haɗu da Database...");

    const db = conn.connection.db;

    // Goge kai-tsaye ta asalin collection din MongoDB ba tare da jiran Mongoose Schema ba
    const result = await db.collection("users").deleteMany({
      $or: [
        { email: { $regex: /usmanaliado/i } },
        { email: "usmanaliado@ayaxdata.online" },
        { phone: { $regex: /9161538596/ } },         { name: {$regex: /USMAN ALI ADO/i } }
      ]
    });

    console.log(`An yi nasarar goge asusun guda: ${result.deletedCount}`);
    process.exit(0);
  } catch (error) {
    console.error("Kuskure:", error.message);
    process.exit(1);
  }
};

deleteDirect();