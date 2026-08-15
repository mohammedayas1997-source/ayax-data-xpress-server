const User = require("../models/User");
const BVNPrice = require("../models/BVNPrice");
const BVNRequest = require("../models/BVNRequest");
const Activity = require("../models/Activity");

/**
 * @desc    Get all BVN service prices
 * @route   GET /api/v1/bvn/prices
 * @access  Private
 */
exports.getBVNPrices = async (req, res) => {
  try {
    const prices = await BVNPrice.find();

    res.status(200).json({
      success: true,
      count: prices.length,
      data: prices,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching BVN prices: " + error.message,
    });
  }
};

/**
 * @desc    Set or Update BVN price (Admin Only)
 * @route   POST /api/v1/bvn/admin/set-price
 * @access  Private/Admin
 */
exports.setBVNPrice = async (req, res) => {
  try {
    const { serviceType, amount } = req.body;

    if (!serviceType || !amount) {
      return res.status(400).json({
        success: false,
        message: "Please provide both serviceType and amount",
      });
    }

    const price = await BVNPrice.findOneAndUpdate(
      { serviceType },
      { amount: Number(amount) },
      { new: true, upsert: true, runValidators: true },
    );

    res.status(200).json({
      success: true,
      message: `${serviceType.replace("_", " ").toUpperCase()} price updated successfully`,
      data: price,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to set BVN price: " + error.message,
    });
  }
};

/**
 * @desc    Verify BVN (Main Logic)
 * @route   POST /api/v1/bvn/verify
 * @access  Private
 */
exports.verifyBVN = async (req, res) => {
  try {
    const { bvnNumber, serviceType, ...otherDetails } = req.body;
    const userId = req.user._id;

    if (!bvnNumber || !serviceType) {
      return res.status(400).json({
        success: false,
        message: "Please provide bvnNumber and serviceType",
      });
    }

    // 1. Tabbatar da Farashin sabis (Fetch price from BVNPrice model)
    const priceDoc = await BVNPrice.findOne({ serviceType });
    if (!priceDoc) {
      return res.status(400).json({
        success: false,
        message: "Invalid service type or price not configured",
      });
    }
    const serviceFee = Number(priceDoc.amount);

    // 2. Binciken kuɗin Wallet (Wallet Balance Check)
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const currentBal = user.walletBalance !== undefined ? user.walletBalance : (user.balance || 0);

    if (currentBal < serviceFee) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Required: ₦${serviceFee}, Available: ₦${currentBal}`,
      });
    }

    // 3. Cire kuɗi daga Wallet ɗin mai amfani
    user.walletBalance = currentBal - serviceFee;
    if (user.balance !== undefined) user.balance = user.walletBalance;

    if (!user.transactions) user.transactions = [];
    user.transactions.push({
      type: "debit",
      amount: serviceFee,
      status: "success",
      description: `BVN Verification charge for ${serviceType}`,
      date: new Date(),
    });

    await user.save();

    // 4. Ajiye Buƙatar a cikin BVNRequest Model (Logging the request)
    const newBVNRequest = await BVNRequest.create({
      user: userId,
      bvnNumber,
      serviceType,
      amount: serviceFee,
      status: "pending", // Ko "processing" dangane da tsarin ka
      ...otherDetails,
    });

    // 5. Rubuta Activity Log
    await Activity.create({
      staffId: userId,
      action: "BVN_VERIFICATION_INITIATED",
      details: `Initiated BVN verification (${serviceType}) for ₦${serviceFee}`,
      targetUser: userId,
    });

    res.status(200).json({
      success: true,
      message: "BVN verification request submitted successfully",
      data: newBVNRequest,
      newBalance: user.walletBalance,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Verification failed: " + error.message,
    });
  }
};