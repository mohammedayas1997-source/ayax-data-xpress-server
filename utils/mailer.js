const nodemailer = require("nodemailer");

/**
 * Professional Mailer Configuration
 * Ana amfani da Environment Variables don tsaro
 */
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "mail.ayaxdata.online",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER || "support@ayaxdata.online",
    pass: process.env.EMAIL_PASS || "Ayas1997@", // Shawarata: Sanya wannan a .env file
  },
  // Wannan yana taimakawa wurin hana kuskuren SSL a wasu sabobin
  tls: {
    rejectUnauthorized: false,
  },
});

/**
 * sendMail Function
 */
const sendMail = async (to, subject, html) => {
  try {
    // Tabbatar da cewa hadin gwiwa (connection) yana da kyau
    await transporter.verify();

    const info = await transporter.sendMail({
      from: `"Ayax Data Xpress" <${process.env.EMAIL_USER || "support@ayaxdata.online"}>`,
      to: to,
      subject: subject,
      html: html,
    });

    console.log("[AYAX MAIL] Sent: %s", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("[AYAX MAIL] Error:", error.message);
    return { success: false, error: error.message };
  }
};

module.exports = sendMail;
