const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction"); // Muna bukatar wannan don yin record

// 1. Verify Meter Number
exports.verifyMeter = async (req, res) => {
  const { electricCompany, meterNo, meterType } = req.body;

  if (!electricCompany || !meterNo || !meterType) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }

  try {
    const url = `https://www.nellobytesystems.com/APIVerifyElectricityV1.asp?UserID=${process.env.CLUBKONNECT_USERID}&APIKey=${process.env.CLUBKONNECT_APIKEY}&ElectricCompany=${electricCompany}&MeterNo=${meterNo}&MeterType=${meterType}`;

    const response = await axios.get(url, { timeout: 15000 }); // Sanya timeout gudun Vercel timeout

    // Nellobyte response check
    if (response.data && response.data.name) {
      res.status(200).json({ success: true, customerName: response.data.name });
    } else {
      res.status(400).json({
        success: false,
        message: response.data.remark || "Invalid Meter Number or Company",
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Meter verification service unavailable",
    });
  }
};

// 2. Process Electricity Payment
exports.buyElectricity = async (req, res) => {
  const { electricCompany, meterNo, meterType, amount, phoneNo } = req.body;
  const userId = req.user._id; // Amfani da _id ya fi tabbas

  try {
    // 1. Nemo User
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // 2. Tabbatar da kudi
    const amountNum = Number(amount);
    if (user.walletBalance < amountNum) {
      return res.status(400).json({ message: "Insufficient Wallet Balance" });
    }

    const requestId = `ELEC${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const url = `https://www.nellobytesystems.com/APIElectricityV1.asp?UserID=${process.env.CLUBKONNECT_USERID}&APIKey=${process.env.CLUBKONNECT_APIKEY}&ElectricCompany=${electricCompany}&MeterType=${meterType}&MeterNo=${meterNo}&Amount=${amountNum}&PhoneNo=${phoneNo}&RequestID=${requestId}`;

    // 3. Kira API
    const response = await axios.get(url, { timeout: 30000 });

    if (
      response.data &&
      (response.data.status === "ORDER_RECEIVED" ||
        response.data.status === "ORDER_COMPLETED")
    ) {
      // 4. Cire kudi (Atomic Update is better, but this is fine for now)
      user.walletBalance -= amountNum;
      await user.save();

      // 5. Yi record na Transaction domin nan gaba idan an samu refund
      await Transaction.create({
        user: userId,
        type: "electricity",
        amount: amountNum,
        status: "success",
        reference: response.data.orderid || requestId,
        details: `Electricity payment for ${meterNo} (${electricCompany})`,
      });

      res.status(200).json({
        success: true,
        message: "Payment Successful",
        orderId: response.data.orderid,
        token: response.data.metertoken || "Pending", // Wasu kamfanonin suna bada token nan take
      });
    } else {
      res.status(400).json({
        success: false,
        message: response.data.remark || "Transaction failed from provider",
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Payment processing error",
      error: error.message,
    });
  }
};
