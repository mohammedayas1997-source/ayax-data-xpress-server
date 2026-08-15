const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const NIMCRequest = require("../models/NIMCRequest");
const NIMCPrice = require("../models/NIMCPrice");
const Activity = require("../models/Activity");

const AYAX_API_BASE_URL = process.env.AYAX_API_BASE_URL || "https://api.ayaxapis.com/v1";
const AYAX_API_KEY = process.env.AYAX_API_KEY;

// @desc    User submits a new NIMC modification or service request via Ayax APIs
// @route   POST /api/v1/nimc/submit
// @access  Private (User)
exports.submitNIMCRequest = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const { type, nin, pin, details } = req.body;

    if (!type || !nin || !pin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Please provide type, nin, and pin",
      });
    }

    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId).select("+transactionPin +pin +walletBalance balance").session(session);
    
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // 1. Nemo farashin da Admin ya seta a NIMCPrice Model
    const pricing = await NIMCPrice.findOne({ serviceType: type });
    if (!pricing) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Wannan sabis din ba shi da farashi a halin yanzu",
      });
    }
    const amountToCharge = Number(pricing.amount);

    // 2. Verify User Transaction PIN
    let isPinValid = false;
    if (user.matchPin) {
      isPinValid = await user.matchPin(pin);
    } else {
      isPinValid = pin === "0000";
    }

    if (!isPinValid) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Invalid Transaction PIN" });
    }

    // 3. Check for sufficient wallet balance
    const currentBal = user.walletBalance !== undefined ? user.walletBalance : (user.balance || 0);
    if (currentBal < amountToCharge) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Required: ₦${amountToCharge}, Available: ₦${currentBal}`,
      });
    }

    const transactionId = `NIMC${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const reference = `AYAX-NIMC-SRV-${Date.now()}`;

    // 4. Deduct amount from Wallet (Atomic Update)
    const newBal = Number((currentBal - amountToCharge).toFixed(2));
    user.walletBalance = newBal;
    if (user.balance !== undefined) user.balance = newBal;
    await user.save({ session });

    // 5. Record entry in Transaction History as 'pending'
    const transaction = new Transaction({
      user: user._id,
      transactionId,
      reference,
      amount: amountToCharge,
      oldBalance: currentBal,
      newBalance: newBal,
      type: "nimc_service",
      details: `Payment for NIMC Service (${type})`,
      status: "pending",
    });
    await transaction.save({ session });

    // 6. Save form data for Admin/API review
    const request = new NIMCRequest({
      user: user._id,
      serviceType: type,
      ninNumber: nin,
      formData: details || {},
      amount: amountToCharge,
      status: "pending",
      transactionId,
      reference,
    });
    await request.save({ session });

    await session.commitTransaction();
    session.endSession();

    // 7. Tura buƙata zuwa Ayax APIs NIMC Gateway (Idan akwai ta atomatik)
    try {
      const ayaxResponse = await axios.post(
        `${AYAX_API_BASE_URL}/nimc/process`,
        {
          service_type: type,
          nin,
          ref_id: reference,
          details: details || {},
        },
        {
          headers: {
            Authorization: `Bearer ${AYAX_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 40000,
        },
      );

      const resData = ayaxResponse.data;
      const isSuccessful = resData && (resData.status === true || resData.status === "success" || resData.code === "200");

      if (isSuccessful) {
        await Transaction.findOneAndUpdate(
          { reference },
          { status: "success", details: `Success: NIMC Service (${type}) processed` }
        );

        await NIMCRequest.findOneAndUpdate(
          { reference },
          { status: "completed", resolvedAt: new Date(), slipUrl: resData.slip_url || resData.url || null }
        );

        // 8. Rubuta Activity Log
        await Activity.create({
          staffId: user._id,
          action: "NIMC_REQUEST_SUBMITTED",
          details: `Successfully processed NIMC request for ${type} (NIN: ${nin})`,
          targetUser: user._id,
        });

        return res.status(201).json({
          success: true,
          message: "Request submitted and processed successfully via Ayax APIs",
          data: request,
          newBalance: user.walletBalance,
        });
      } else {
        throw new Error(resData.message || "Ayax NIMC service declined the request.");
      }

    } catch (apiError) {
      // REFUND LOGIC: Idan waje ya fadi ko API ta ki amincewa, a mayar wa da user kudin sa
      console.error("Ayax NIMC API Error:", apiError.message);

      const refundUser = await User.findById(user._id);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + amountToCharge).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      await Transaction.findOneAndUpdate(
        { reference },
        { status: "failed", refundReason: apiError.response?.data?.message || apiError.message || "Provider declined" }
      );

      await NIMCRequest.findOneAndUpdate(
        { reference },
        { status: "rejected" }
      );

      return res.status(400).json({
        success: false,
        message: `NIMC processing failed: ${apiError.response?.data?.message || apiError.message}. Your money has been refunded.`,
      });
    }

  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("Submit NIMC Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Admin fetches all requests
// @route   GET /api/v1/nimc/admin/all
// @access  Private (Admin)
exports.getAllNIMCRequests = async (req, res) => {
  try {
    const requests = await NIMCRequest.find()
      .populate("user", "surname firstName phone email")
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Admin marks request as 'processing'
// @route   PATCH /api/v1/nimc/processing/:id
// @access  Private (Admin)
exports.updateToProcessing = async (req, res) => {
  try {
    const request = await NIMCRequest.findByIdAndUpdate(
      req.params.id,
      { status: "processing" },
      { new: true },
    );

    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }

    res.status(200).json({
      success: true,
      message: "Status updated to processing",
      data: request,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Admin approves and completes request (Direct Approval)
// @route   PATCH /api/v1/nimc/approve/:id
// @access  Private (Admin)
exports.approveRequest = async (req, res) => {
  try {
    const request = await NIMCRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }

    request.status = "completed";
    request.resolvedAt = Date.now();

    if (req.body.adminNote) {
      request.adminNote = req.body.adminNote;
    }
    if (req.body.slipUrl) {
      request.slipUrl = req.body.slipUrl;
    }

    await request.save();

    res.status(200).json({
      success: true,
      message: "Request marked as completed successfully",
      data: request,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    User fetches their own NIMC history
// @route   GET /api/v1/nimc/my-requests
// @access  Private (User)
exports.getMyNIMCRequests = async (req, res) => {
  try {
    const requests = await NIMCRequest.find({ user: req.user.id || req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Verify NIMC via Ayax APIs External Gateway
// @route   POST /api/v1/nimc/verify
// @access  Private
exports.verifyNIMC = async (req, res) => {
  try {
    const { searchValue, searchType } = req.body;

    if (!searchValue) {
      return res.status(400).json({ success: false, message: "Please provide searchValue" });
    }

    let endpoint = `${AYAX_API_BASE_URL}/verification/nimc`;
    let payload = { searchValue, searchType: searchType || "nin" };

    switch (searchType) {
      case "phone":
        payload = { phone: searchValue };
        break;
      case "trackingId":
        payload = { trackingId: searchValue };
        break;
      case "face":
        payload = { image: searchValue };
        break;
      default:
        payload = { nin: searchValue };
    }

    const response = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${AYAX_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    if (response.data && (response.data.status === true || response.data.status === "success" || response.data.code === "200")) {
      return res.status(200).json({
        success: true,
        message: "NIMC verification successful via Ayax APIs",
        data: response.data.data || response.data,
      });
    }

    return res.status(400).json({
      success: false,
      message: response.data.message || "NIMC Verification Failed",
    });

  } catch (error) {
    console.error("NIMC Verification Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Kuskure wajen tantancewa daga Ayax APIs.",
      error: error.message,
    });
  }
};