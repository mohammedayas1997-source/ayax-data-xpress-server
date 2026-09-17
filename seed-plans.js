const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const mongoose = require("mongoose");

const planSchema = new mongoose.Schema({
  network: { type: String, required: true },
  planType: { type: String, default: "SME" },
  plan: { type: String, required: true },
  validity: { type: String, default: "30 Days" },
  costPrice: { type: Number, required: true },
  userPrice: { type: Number, required: true },
  apiPrice: { type: Number, default: 0 },
  planId: { type: String, required: true },
  status: { type: String, default: "active" },
  isActive: { type: Boolean, default: true },
});

const DataPlan = mongoose.models.DataPlan || mongoose.model("DataPlan", planSchema);

const alihsanPlans = [
  // MTN PLANS
  {
    network: "MTN",
    planType: "SME",
    plan: "500.0MB",
    validity: "30 Days",
    costPrice: 250,
    userPrice: 290,
    planId: "17",
  },
  {
    network: "MTN",
    planType: "Corporate Gifting",
    plan: "500.0MB",
    validity: "30 Days",
    costPrice: 310,
    userPrice: 350,
    planId: "26",
  },
  {
    network: "MTN",
    planType: "Corporate Gifting",
    plan: "1.0GB",
    validity: "30 Days",
    costPrice: 400,
    userPrice: 450,
    planId: "27",
  },
  {
    network: "MTN",
    planType: "Corporate Gifting",
    plan: "2.0GB",
    validity: "30 Days",
    costPrice: 810,
    userPrice: 900,
    planId: "28",
  },
  {
    network: "MTN",
    planType: "Corporate Gifting",
    plan: "5.0GB",
    validity: "30 Days",
    costPrice: 1900,
    userPrice: 2100,
    planId: "38",
  },

  // 9MOBILE PLANS
  {
    network: "9MOBILE",
    planType: "Gifting",
    plan: "500.0MB",
    validity: "30 Days",
    costPrice: 480,
    userPrice: 550,
    planId: "45",
  },
  {
    network: "9MOBILE",
    planType: "Gifting",
    plan: "1.5GB",
    validity: "30 Days",
    costPrice: 900,
    userPrice: 1000,
    planId: "11",
  },

  // AIRTEL PLANS
  {
    network: "AIRTEL",
    planType: "Gifting",
    plan: "2.0GB",
    validity: "30 Days",
    costPrice: 1500,
    userPrice: 1650,
    planId: "50",
  },
  {
    network: "AIRTEL",
    planType: "Gifting",
    plan: "3.0GB",
    validity: "30 Days",
    costPrice: 1950,
    userPrice: 2100,
    planId: "51",
  },
];

async function seedDatabase() {
  const mongoUri =
    process.env.MONGODB_URI ||
    process.env.DATABASE_URL ||
    process.env.MONGO_URI ||
    process.env.DB_URL;

  if (!mongoUri) {
    console.error("Error: No MongoDB URI found. Check your .env file.");
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB.");

    await DataPlan.deleteMany({});
    console.log("Existing plans cleared.");

    await DataPlan.insertMany(alihsanPlans);
    console.log("Al-Ihsan plans successfully inserted into the database.");
  } catch (err) {
    console.error("Seeding failed:", err.message);
  } finally {
    await mongoose.disconnect();
  }
}

seedDatabase();