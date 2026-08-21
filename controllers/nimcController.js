const axios = require("axios");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const NIMCRequest = require("../models/NIMCRequest");
const NIMCPrice = require("../models/NIMCPrice");
const Activity = require("../models/Activity");

// 1. Tabbatar da Ingantaccen URL ba tare da maimaita /api/v1 ba
const RAW_URL =
  process.env.AYAX_API_BASE_URL ||
  process.env.MARKETPLACE_API_URL ||
  "https://ayax-api-marketplace.onrender.com";

const CLEAN_BASE = RAW_URL.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
const AYAX_API_BASE_URL = `${CLEAN_BASE}/api/v1`;

const AYAX_API_KEY =
  process.env.AYAX_API_KEY ||
  process.env.MARKETPLACE_API_KEY ||
  "ayax_live_13e936ef28c32f2b9d99f2974949e411608490dc069de75ad06f165251eb5345";

// Helper don tsara Headers
const getHeaders = () => ({
  "Content-Type": "application/json",
  "x-api-key": AYAX_API_KEY,
  Authorization: `Bearer ${AYAX_API_KEY}`,
});

// @desc    User submits a new NIMC modification or service request via Ayax APIs
// @route   POST /api/v1/nimc/request-modification (ko /api/v1/nimc/submit)
// @access  Private (User)
exports.submitNIMCRequest = async (req, res) => {
  const session = await User.startSession();
  session.startTransaction();

  try {
    const { type, serviceType, nin, ninNumber, pin, details, formData } = req.body;

    const finalServiceType = serviceType || type;
    const finalNin = ninNumber || nin;
    const finalDetails = formData || details || {};

    if (!finalServiceType || !finalNin || !pin) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Please provide serviceType (or type), ninNumber (or nin), and pin",
      });
    }

    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId)
      .select("+transactionPin +pin +walletBalance balance")
      .session(session);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // 1. Nemo farashin da Admin ya seta a NIMCPrice Model
    const pricing = await NIMCPrice.findOne({ serviceType: finalServiceType });
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
    } else if (user.transactionPin) {
      isPinValid = String(user.transactionPin) === String(pin);
    } else if (user.pin) {
      isPinValid = String(user.pin) === String(pin);
    } else {
      isPinValid = pin === "0000";
    }

    if (!isPinValid) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: "Invalid Transaction PIN" });
    }

    // 3. Check for sufficient wallet balance
    const currentBal = Number(user.walletBalance ?? user.balance ?? 0);
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
      category: "identity",
      details: `Payment for NIMC Service (${finalServiceType})`,
      status: "pending",
    });
    await transaction.save({ session });

    // 6. Save form data for Admin/API review
    const request = new NIMCRequest({
      user: user._id,
      serviceType: finalServiceType,
      ninNumber: String(finalNin).trim(),
      formData: finalDetails,
      amount: amountToCharge,
      status: "pending",
      transactionId,
      reference,
    });
    await request.save({ session });

    await session.commitTransaction();
    session.endSession();

    // 7. Tura buƙata zuwa Ayax APIs NIMC Gateway
    try {
      const ayaxResponse = await axios.post(
        `${AYAX_API_BASE_URL}/identity/nimc/process`,
        {
          serviceType: finalServiceType,
          nin: String(finalNin).trim(),
          reference,
          ref_id: reference,
          details: finalDetails,
          amount: amountToCharge,
        },
        {
          headers: getHeaders(),
          timeout: 40000,
        }
      );

      const resData = ayaxResponse.data;
      const isSuccessful =
        resData &&
        (resData.success === true ||
          resData.status === "success" ||
          resData.status === true ||
          resData.code === 200 ||
          resData.code === "200");

      if (isSuccessful) {
        await Transaction.findOneAndUpdate(
          { reference },
          { status: "success", details: `Success: NIMC Service (${finalServiceType}) processed` }
        );

        await NIMCRequest.findOneAndUpdate(
          { reference },
          {
            status: "completed",
            resolvedAt: new Date(),
            slipUrl: resData.data?.slipUrl || resData.slip_url || resData.url || null,
          }
        );

        // 8. Rubuta Activity Log
        await Activity.create({
          user: user._id,
          staffId: user._id,
          action: "NIMC_REQUEST_SUBMITTED",
          details: `Successfully processed NIMC request for ${finalServiceType} (NIN: ${finalNin})`,
          targetUser: user._id,
        }).catch((err) => console.warn("Activity log error:", err.message));

        return res.status(201).json({
          success: true,
          message: "Request submitted and processed successfully via Ayax APIs",
          data: request,
          newBalance: user.walletBalance,
        });
      } else {
        throw new Error(resData?.message || "Ayax NIMC service declined the request.");
      }
    } catch (apiError) {
      // REFUND LOGIC: Idan server ta fadi ko provider ya ki amincewa, a mayar wa user kudinsa
      console.error("Ayax NIMC API Error:", apiError.response?.status, apiError.response?.data || apiError.message);

      const refundUser = await User.findById(user._id);
      if (refundUser) {
        refundUser.walletBalance = Number((refundUser.walletBalance + amountToCharge).toFixed(2));
        if (refundUser.balance !== undefined) refundUser.balance = refundUser.walletBalance;
        await refundUser.save();
      }

      const reason =
        apiError.response?.data?.message || apiError.message || "Provider declined";

      await Transaction.findOneAndUpdate(
        { reference },
        { status: "failed", refundReason: reason, details: `Failed & Refunded: ${reason}` }
      );

      await NIMCRequest.findOneAndUpdate({ reference }, { status: "rejected" });

      return res.status(400).json({
        success: false,
        message: `NIMC processing failed: ${reason}. Your money has been refunded.`,
      });
    }
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("Submit NIMC Error:", error);
    return res.status(500).json({ success: false, message: error.message });
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

    return res.status(200).json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
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
      { new: true }
    );

    if (!request) {
      return res.status(404).json({ success: false, message: "Request not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Status updated to processing",
      data: request,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
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

    return res.status(200).json({
      success: true,
      message: "Request marked as completed successfully",
      data: request,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
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

    return res.status(200).json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
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

    const payload = {
      searchValue: String(searchValue).trim(),
      searchType: searchType || "nin",
    };

    if (searchType === "phone") {
      payload.phone = searchValue;
    } else if (searchType === "trackingId") {
      payload.trackingId = searchValue;
    } else if (searchType === "face") {
      payload.image = searchValue;
    } else {
      payload.nin = searchValue;
    }

    const response = await axios.post(
      `${AYAX_API_BASE_URL}/identity/nin/verify`,
      payload,
      {
        headers: getHeaders(),
        timeout: 30000,
      }
    );

    const resData = response.data;
    const isSuccessful =
      resData &&
      (resData.success === true ||
        resData.status === "success" ||
        resData.status === true ||
        resData.code === 200 ||
        resData.code === "200");

    if (isSuccessful) {
      return res.status(200).json({
        success: true,
        message: "NIMC verification successful via Ayax APIs",
        data: resData.data || resData,
      });
    }

    return res.status(400).json({
      success: false,
      message: resData?.message || "NIMC Verification Failed",
    });
  } catch (error) {
    console.error("NIMC Verification Error:", error.response?.status, error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || "Kuskure wajen tantancewa daga Ayax APIs.",
      error: error.message,
    });
  }
};