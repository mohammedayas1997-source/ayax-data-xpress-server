const ValidationRequest = require("../models/ValidationRequest");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Activity = require("../models/Activity");
const axios = require("axios");

const AYAX_API_BASE_URL = process.env.AYAX_API_BASE_URL || "https://api.ayaxapis.com/v1";
const AYAX_API_KEY = process.env.AYAX_API_KEY;

// @desc    User submits a new Validation request via Ayax APIs
// @route   POST /api/v1/validation/submit
// @access  Private
exports.submitValidation = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const { type, nin, pin, amount, formData } = req.body;
    
    // Amfani da req.user._id daga auth middleware domin tsaro
    const userId = req.user ? (req.user._id || req.user.id) : req.body.userId;

    if (!type || !nin || !pin || amount === undefined || !userId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields (type, nin, pin, amount)",
      });
    }

    const user = await User.findById(userId).select("+pin +walletBalance balance").session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 1. Tabbatar da PIN din mai amfani (Transaction PIN Verification)
    let isPinValid = false;
    if (user.matchPin) {
      isPinValid = await user.matchPin(pin);
    } else {
      isPinValid = pin === "0000"; // Tabbataccen tsohon tsari idan babu matchPin method
    }

    if (!isPinValid) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Security Error: Invalid Transaction PIN",
      });
    }

    // 2. Duba balance na user
    const currentBal = user.walletBalance !== undefined ? user.walletBalance : (user.balance || 0);
    const amountNum = Number(amount);

    if (currentBal < amountNum) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Kudinka bai isa ba! Required: ₦${amountNum}, Available: ₦${currentBal}`,
      });
    }

    const transactionId = `VAL${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const reference = `AYAX-VAL-${Date.now()}`;

    // 3. Cire kudi daga wallet nan take (Atomic Update)
    const newBal = Number((currentBal - amountNum).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) {
      user.balance = newBal;
    }
    await user.save({ session });

    // 4. Ajiye bayanan transaction a Transaction Model a matsayin 'pending'
    const transaction = new Transaction({
      user: userId,
      transactionId,
      reference,
      amount: amountNum,
      oldBalance: currentBal,
      newBalance: newBal,
      type: "validation_service",
      details: `Payment for Validation Service (${type})`,
      status: "pending",
    });
    await transaction.save({ session });

    // 5. Ajiye bayanan validation din a cikin ValidationRequest Model
    const newRequest = new ValidationRequest({
      user: userId,
      userId,
      type,
      nin,
      amount: amountNum,
      status: "pending",
      transactionId,
      reference,
      formData: formData || {},
    });
    await newRequest.save({ session });

    await session.commitTransaction();
    session.endSession();

    // 6. Tura buƙata zuwa Ayax APIs Verification Gateway
    let response;
    try {
      response = await axios.post(
        `${AYAX_API_BASE_URL}/verification/process`, // Canza zuwa zahirin endpoint din Ayax APIs
        {
          service_type: type,
          nin,
          ref_id: reference,
          ...formData,
        },
        {
          headers: {
            Authorization: `Bearer ${AYAX_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 40000,
        },
      );
    } catch (apiError) {
      console.error("Ayax Validation API Network Error:", apiError.message);

      // REFUND LOGIC: Idan waje ya fadi, a mayar wa da user kudin sa
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + amountNum).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      await Transaction.findOneAndUpdate(
        { reference },
        { status: "failed", refundReason: "Gateway connection error" }
      );

      await ValidationRequest.findOneAndUpdate(
        { reference },
        { status: "failed" }
      );

      return res.status(502).json({
        success: false,
        message: "Failed to connect to Ayax verification gateway. Your money has been refunded.",
      });
    }

    const resData = response.data;
    const isSuccessful = resData && (resData.status === true || resData.status === "success" || resData.code === "200");

    if (isSuccessful) {
      // Sabunta status ya zama success ko completed
      await Transaction.findOneAndUpdate(
        { reference },
        { status: "success", details: `Success: Validation completed for ${type}` }
      );

      await ValidationRequest.findOneAndUpdate(
        { reference },
        { status: "completed", responseDetails: resData.data || resData }
      );

      // Rubuta Activity Log
      await Activity.create({
        staffId: userId,
        action: "VALIDATION_REQUEST_COMPLETED",
        details: `Successfully processed validation for ${type} (NIN: ${nin}) worth ₦${amountNum}`,
        targetUser: userId,
      });

      return res.status(200).json({
        success: true,
        message: "An sarrafa bukatarka cikin nasara",
        data: {
          request: newRequest,
          providerResponse: resData.data || resData,
        },
        newBalance: user.walletBalance,
      });
    } else {
      // REFUND LOGIC: Idan Ayax API ta ki amincewa da request din
      const refundUser = await User.findById(userId);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + amountNum).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      await Transaction.findOneAndUpdate(
        { reference },
        { status: "failed", refundReason: resData.message || "Provider declined" }
      );

      await ValidationRequest.findOneAndUpdate(
        { reference },
        { status: "failed" }
      );

      return res.status(400).json({
        success: false,
        message: resData.message || "Ayax validation service declined the request. Money refunded.",
      });
    }

  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("Submit Validation Error:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Server error while processing validation request", 
      error: error.message 
    });
  }
};