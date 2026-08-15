const axios = require("axios");
const User = require("../models/User");

/**
 * @desc    Get or Create Dedicated Virtual Account for User
 * @route   POST /api/v1/virtual-account/create
 * @access  Private (Protected)
 */
exports.getOrCreateVirtualAccount = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Idan har user yana da account riga, a dawo masa da shi kai tsaye
    if (user.paystackCustomerCode && user.virtualAccount && user.virtualAccount.accountNumber) {
      return res.status(200).json({
        success: true,
        message: "Virtual account already exists",
        data: user.virtualAccount,
      });
    }

    // 1. Ƙirƙirar Customer a Paystack
    const customerResponse = await axios.post(
      "https://api.paystack.co/customer",
      {
        email: user.email,
        first_name: user.name ? user.name.split(" ")[0] : "User",
        last_name: user.name && user.name.split(" ")[1] ? user.name.split(" ")[1] : "Customer",
        phone: user.phone || "08000000000",
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const customerCode = customerResponse.data.data.customer_code;

    // 2. Ƙirƙirar Dedicated Virtual Account (DVA)
    const dvaResponse = await axios.post(
      "https://api.paystack.co/dedicated_account",
      {
        customer: customerCode,
        preferred_bank: "wema-bank", // Zaka iya canza bankin idan kana so
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const accountData = dvaResponse.data.data;

    // 3. Ajiye bayanan a cikin Database na User
    user.paystackCustomerCode = customerCode;
    user.virtualAccount = {
      accountNumber: accountData.account_number,
      accountName: accountData.account_name,
      bankName: accountData.bank.name,
    };
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Virtual account created successfully",
      data: user.virtualAccount,
    });
  } catch (error) {
    console.error("Create Virtual Account Error:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: "Ba a samu nasarar ƙirƙirar Virtual Account ba",
      error: error.response?.data?.message || error.message,
    });
  }
};