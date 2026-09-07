const axios = require("axios");
const User = require("../models/User");

/**
 * @desc    Get or Create Dedicated Virtual Account for User
 * @route   POST /api/v1/virtual-account/create
 * @access  Private (Protected)
 */
exports.getOrCreateVirtualAccount = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // 1. Idan har user yana da account a riga, a dawo masa da shi kai tsaye
    if (user.virtualAccount && user.virtualAccount.accountNumber) {
      return res.status(200).json({
        success: true,
        message: "Virtual account already exists",
        data: user.virtualAccount,
      });
    }

    // 2. Tabbatar da samun lambar waya mai inganci
    let userPhone = String(user.phone || "").replace(/[^0-9]/g, "").trim();
    if (!userPhone || userPhone.length < 10) {
      userPhone = "09033738409";
    } else if (userPhone.length === 10) {
      userPhone = `0${userPhone}`;
    }

    const firstName = user.firstName || (user.name ? user.name.split(" ")[0] : "Customer");
    const surname = user.surname || (user.name && user.name.split(" ")[1] ? user.name.split(" ")[1] : "Ayax");

    // 3. Ƙirƙirar Customer a Paystack
    const customerResponse = await axios.post(
      "https://api.paystack.co/customer",
      {
        email: user.email,
        first_name: firstName,
        last_name: surname,
        phone: userPhone,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const customerCode = customerResponse.data.data.customer_code;

    // 4. Ƙirƙirar Dedicated Virtual Account (DVA)
    const dvaResponse = await axios.post(
      "https://api.paystack.co/dedicated_account",
      {
        customer: customerCode,
        preferred_bank: "wema-bank",
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const accountData = dvaResponse.data.data;

    // 5. Ajiye bayanan a cikin Database na User
    user.paystackCustomerCode = customerCode;
    user.bankName = accountData.bank?.name || "Wema Bank";
    user.accountNumber = accountData.account_number;
    user.accountName = accountData.account_name || `${firstName} ${surname}`;
    user.virtualAccount = {
      accountNumber: accountData.account_number,
      accountName: accountData.account_name || `${firstName} ${surname}`,
      bankName: accountData.bank?.name || "Wema Bank",
    };

    await user.save({ validateBeforeSave: false });

    return res.status(200).json({
      success: true,
      message: "Virtual account created successfully",
      data: user.virtualAccount,
    });
  } catch (error) {
    console.error("Create Virtual Account Error:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: error.response?.data?.message || "Could not generate virtual account.",
      error: error.response?.data || error.message,
    });
  }
};