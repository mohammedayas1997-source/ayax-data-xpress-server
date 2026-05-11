const User = require("../models/User");
const Transaction = require("../models/Transaction");
const NIMCRequest = require("../models/NIMCRequest");
const NIMCPrice = require("../models/NIMCPrice");

// @desc    User submits a new NIMC modification request
// @route   POST /api/v1/nimc/submit
// @access  Private (User)
exports.submitNIMCRequest = async (req, res) => {
  try {
    const { type, nin, pin, details } = req.body;
    const user = await User.findById(req.user.id).select("+pin +walletBalance");

    // 1. Nemo farashin da Admin ya seta a NIMCPrice Model
    const pricing = await NIMCPrice.findOne({ serviceType: type });
    if (!pricing) {
      return res.status(400).json({
        success: false,
        message: "Wannan sabis din ba shi da farashi a halin yanzu",
      });
    }
    const amountToCharge = pricing.amount;

    // 2. Verify User Transaction PIN
    const isPinValid = await user.matchPin(pin);
    if (!isPinValid) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Transaction PIN" });
    }

    // 3. Check for sufficient wallet balance
    if (user.walletBalance < amountToCharge) {
      return res
        .status(400)
        .json({ success: false, message: "Insufficient wallet balance" });
    }

    // 4. Deduct amount from Wallet
    user.walletBalance -= amountToCharge;
    await user.save();

    // 5. Record entry in Transaction History
    await Transaction.create({
      user: user._id,
      amount: amountToCharge,
      type: "nimc_service",
      description: `Payment for ${type}`,
      status: "success",
    });

    // 6. Save form data for Admin review
    const request = await NIMCRequest.create({
      user: user._id,
      serviceType: type,
      ninNumber: nin,
      formData: details,
      amount: amountToCharge,
      status: "pending",
    });

    res.status(201).json({
      success: true,
      message: "Request submitted successfully",
      data: request,
    });
  } catch (error) {
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
      .sort({ createdAt: -1 });

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
      return res
        .status(404)
        .json({ success: false, message: "Request not found" });
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

// @desc    Admin approves and completes request (Direct Approval - No File Upload)
// @route   PATCH /api/v1/nimc/approve/:id
// @access  Private (Admin)
exports.approveRequest = async (req, res) => {
  try {
    const request = await NIMCRequest.findById(req.params.id);

    if (!request) {
      return res
        .status(404)
        .json({ success: false, message: "Request not found" });
    }

    // Update status to completed
    request.status = "completed";
    request.resolvedAt = Date.now();

    // Idan Admin ya turo bayani (Note) a jiki
    if (req.body.adminNote) {
      request.adminNote = req.body.adminNote;
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
    const requests = await NIMCRequest.find({ user: req.user.id }).sort({
      createdAt: -1,
    });

    res.status(200).json({
      success: true,
      data: requests,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.verifyNIMC = async (req, res) => {
  try {
    const { searchValue, searchType } = req.body;
    // searchType zai iya zama: 'nin', 'phone', 'trackingId', ko 'face'

    const apiKey = process.env.NIMC_API_KEY;
    const apiBaseUrl = "https://api.yourprovider.com/v1"; // Misali: Prembly ko QoreID

    let endpoint = "";
    let payload = {};

    // Saita Endpoint gwargwadon yadda mutum yake son bincike
    switch (searchType) {
      case "phone":
        endpoint = `${apiBaseUrl}/nimc-phone`;
        payload = { phone: searchValue };
        break;
      case "trackingId":
        endpoint = `${apiBaseUrl}/nimc-tracking`;
        payload = { trackingId: searchValue };
        break;
      case "face":
        endpoint = `${apiBaseUrl}/nimc-face`;
        payload = { image: searchValue }; // Base64 image
        break;
      default:
        endpoint = `${apiBaseUrl}/nimc-nin`;
        payload = { nin: searchValue };
    }

    const response = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (response.data.success) {
      const citizen = response.data.data;

      // Anan za ka iya cire kudi a wallet din user kafin ka nuna bayanan
      // await User.findByIdAndUpdate(req.user.id, { $inc: { walletBalance: -100 } });

      res.status(200).json({
        success: true,
        data: {
          fullName: `${citizen.firstName} ${citizen.surname}`,
          photo: citizen.photo || citizen.image, // Hoton mutum na asali
          nin: citizen.nin,
          phone: citizen.phone,
          gender: citizen.gender,
          dob: citizen.dob,
          trackingId: citizen.trackingId,
        },
      });
    } else {
      res
        .status(400)
        .json({ success: false, message: "Ba a sami bayanan ba." });
    }
  } catch (error) {
    console.error("NIMC Error:", error.message);
    res
      .status(500)
      .json({ success: false, message: "Kuskure wajen tantancewa." });
  }
};
