const ValidationRequest = require("../models/ValidationRequest");
const User = require("../models/User"); // Zaka iya amfani da User model dinka

exports.submitValidation = async (req, res) => {
  try {
    const { type, nin, pin, amount, userId } = req.body;

    // 1. Duba balance na user (Real life logic)
    const user = await User.findById(userId);
    if (user.balance < amount) {
      return res
        .status(400)
        .json({ success: false, message: "Kudinka bai isa ba!" });
    }

    // 2. Cire kudi (Debit wallet)
    user.balance -= amount;
    await user.save();

    // 3. Ajiye bayanan validation din
    const newRequest = await ValidationRequest.create({
      type,
      nin,
      amount,
      userId,
      status: "pending",
    });

    res.status(200).json({
      success: true,
      message: "An karbi bukatarka",
      data: newRequest,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
