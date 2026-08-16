const User = require("../models/User");
const BVNPrice = require("../models/BVNPrice");
const BVNRequest = require("../models/BVNRequest");
const Activity = require("../models/Activity");
const bcrypt = require("bcryptjs"); // Tabbatar kana da wannan ko kuma hanyar da kake amfani da ita wajen duba PIN

/**
 * @desc    Get all BVN service prices
 * @route   GET /api/v1/bvn/prices
 * @access  Private
 */
exports.getBVNPrices = async (req, res) => {
  try {
    const prices = await BVNPrice.find();

    return res.status(200).json({
      success: true,
      count: prices.length,
      data: prices,
    });
  } catch (error) {
    return res.status(500).json({
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

    if (!serviceType || amount === undefined) {
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

    return res.status(200).json({
      success: true,
      message: `${serviceType.replace("_", " ").toUpperCase()} price updated successfully`,
      data: price,
    });
  } catch (error) {
    return res.status(500).json({
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
    const { bvnNumber, serviceType, pin, ...otherDetails } = req.body;
    const userId = req.user._id;

    if (!bvnNumber || !serviceType) {
      return res.status(400).json({
        success: false,
        message: "Please provide bvnNumber and serviceType",
      });
    }

    // 1. Tabbatar da an shigar da Transaction PIN
    if (!pin) {
      return res.status(400).json({
        success: false,
        message: "Transaction PIN is required",
      });
    }

    // 2. Nemo mai amfani tare da dauko PIN dinsa (a tabbatar ana zabo pin field daga DB)
    const user = await User.findById(userId).select("+pin");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // 3. Tabbatar da cewa PIN ɗin da mai amfani ya igo daidai ne (Idan ana amfani da Hashing ko Plain text)
    // Idan kana adana pin a matsayin plain text: if (user.pin !== pin)
    // Idan kuma kana amfani da hashing (misali bcrypt): const isPinValid = await bcrypt.compare(pin, user.pin);
    const isPinValid = user.pin ? (user.pin === pin || (await bcrypt.compare(pin, user.pin))) : true; 
    
    if (!isPinValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid transaction PIN",
      });
    }

    // 4. Tabbatar da Farashin sabis (Fetch price from BVNPrice model)
    const priceDoc = await BVNPrice.findOne({ serviceType });
    if (!priceDoc) {
      return res.status(400).json({
        success: false,
        message: "Invalid service type or price not configured",
      });
    }
    const serviceFee = Number(priceDoc.amount);

    // 5. Binciken kuɗin Wallet (Wallet Balance Check)
    const currentBal = user.walletBalance !== undefined ? user.walletBalance : (user.balance || 0);

    if (currentBal < serviceFee) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Required: ₦${serviceFee}, Available: ₦${currentBal}`,
      });
    }

    // 6. Cire kuɗi daga Wallet ɗin mai amfani
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

    // 7. Ajiye Buƙatar a cikin BVNRequest Model (Logging the request)
    const newBVNRequest = await BVNRequest.create({
      user: userId,
      bvnNumber,
      serviceType,
      amount: serviceFee,
      status: "pending",
      ...otherDetails,
    });

    // 8. Rubuta Activity Log
    await Activity.create({
      staffId: userId,
      action: "BVN_VERIFICATION_INITIATED",
      details: `Initiated BVN verification (${serviceType}) for ₦${serviceFee}`,
      targetUser: userId,
    });

    return res.status(200).json({
      success: true,
      message: "BVN verification request submitted successfully",
      data: newBVNRequest,
      newBalance: user.walletBalance,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Verification failed: " + error.message,
    });
  }
};