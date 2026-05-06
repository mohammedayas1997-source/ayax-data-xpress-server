const DataPlan = require("../models/DataPlan");

/**
 * @desc    Create or Update a Plan
 * @route   POST /api/v1/admin/set-plan
 */
exports.setPlanPrice = async (req, res) => {
  const {
    networkId,
    planCode,
    userPrice,
    agentPrice,
    planLabel,
    networkName,
    sizeGB, // Ana bukata don Target Tracking
    planType, // SME, Corporate, Gifting
    validity, // 30 Days, 7 Days
  } = req.body;

  // 1. Validation: Tabbatar dukkan muhimman bayanan sun shigo
  // Mun tabbatar networkId da planCode ba su zama fanko ba
  if (
    !networkId ||
    !planCode ||
    userPrice === undefined ||
    agentPrice === undefined
  ) {
    return res.status(400).json({
      success: false,
      message:
        "Please provide all required fields (networkId, planCode, userPrice, agentPrice)",
    });
  }

  try {
    // 2. Nemo plan sannan a yi update, idan babu shi a kera sabo (upsert)
    // Mun sanya komai a cikin findOneAndUpdate tare da dukkan fields din
    const plan = await DataPlan.findOneAndUpdate(
      { networkId: String(networkId), planCode: String(planCode) }, // Force String to avoid matching issues
      {
        userPrice: Number(userPrice), // Tabbatar lamba ce
        agentPrice: Number(agentPrice), // Tabbatar lamba ce
        planLabel,
        networkName,
        sizeGB: sizeGB ? Number(sizeGB) : 0,
        planType,
        validity,
        isActive: true,
      },
      { upsert: true, new: true, runValidators: true },
    );

    res.status(200).json({
      success: true,
      message: "Plan updated successfully",
      plan,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating plan details",
      error: error.message,
    });
  }
};

/**
 * @desc    Get all plans for the App
 * @route   GET /api/v1/plans
 */
exports.getPlans = async (req, res) => {
  try {
    // Nemo dukkan plans masu aiki (isActive: true)
    // Mun jero su ta network sannan kuma ta farashi (daga mai sauki zuwa mai tsada)
    const plans = await DataPlan.find({ isActive: true }).sort({
      networkName: 1,
      userPrice: 1,
    });

    res.status(200).json({
      success: true,
      count: plans.length,
      data: plans,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching plans",
      error: error.message,
    });
  }
};
