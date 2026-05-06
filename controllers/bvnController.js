const BVNPrice = require("../models/BVNPrice");
const BVNRequest = require("../models/BVNRequest");

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
      { amount },
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
    const { bvnNumber, serviceType } = req.body;

    // TODO: Implement Wallet Balance Check
    // TODO: Fetch price from BVNPrice model
    // TODO: Integrate with External Verification API (e.g., Paystack/Monnify)
    // TODO: Deduct funds and log the BVNRequest

    res.status(200).json({
      success: true,
      message: "BVN Verification module is initialized",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Verification failed: " + error.message,
    });
  }
};
