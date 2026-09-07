const axios = require("axios");
const User = require("../models/User");

exports.getOrCreateVirtualAccount = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (user.virtualAccount && user.virtualAccount.accountNumber) {
      return res.status(200).json({
        success: true,
        message: "Virtual account already exists",
        data: user.virtualAccount,
      });
    }

    // Tsaftace lambar waya zuwa daidaitaccen tsarin Najeriya na Paystack
    let rawPhone = String(user.phone || "").replace(/[^0-9]/g, "").trim();
    if (!rawPhone || rawPhone.length < 10) {
      rawPhone = "09033738409";
    }
    if (rawPhone.startsWith("234")) {
      rawPhone = "0" + rawPhone.slice(3);
    } else if (!rawPhone.startsWith("0")) {
      rawPhone = "0" + rawPhone;
    }

    const firstName = user.firstName || (user.name ? user.name.split(" ")[0] : "Customer");
    const surname = user.surname || (user.name && user.name.split(" ")[1] ? user.name.split(" ")[1] : "Ayax");

    const paystackHeaders = {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    };

    // 1. Kirkira ko Sabunta Customer tare da Tabbatacciyar Lambar Waya
    let customerCode = user.paystackCustomerCode;

    if (!customerCode) {
      const customerRes = await axios.post(
        "https://api.paystack.co/customer",
        {
          email: user.email,
          first_name: firstName,
          last_name: surname,
          phone: rawPhone,
        },
        { headers: paystackHeaders }
      );
      customerCode = customerRes.data.data.customer_code;
    } else {
      // Idan yana da customerCode, sabunta lambar wayar don cire kuskuren 'missing_params'
      await axios.put(
        `https://api.paystack.co/customer/${customerCode}`,
        {
          first_name: firstName,
          last_name: surname,
          phone: rawPhone,
        },
        { headers: paystackHeaders }
      );
    }

    // 2. Nemi Dedicated Virtual Account
    const dvaResponse = await axios.post(
      "https://api.paystack.co/dedicated_account",
      {
        customer: customerCode,
        preferred_bank: "wema-bank",
        phone: rawPhone,
      },
      { headers: paystackHeaders }
    );

    const accountData = dvaResponse.data.data;

    // 3. Adana a Database
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
    const errorDetails = error.response?.data || error.message;
    console.error("Create Virtual Account Error:", errorDetails);
    return res.status(500).json({
      success: false,
      message: error.response?.data?.message || "Could not generate virtual account.",
      error: errorDetails,
    });
  }
};