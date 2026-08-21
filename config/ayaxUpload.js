// config/ayaxUpload.js
const axios = require("axios");
const FormData = require("form-data");

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

/**
 * Ayyukan loda fayil zuwa sabar ta Ayax APIs
 * @param {Object} file - Fayil din da aka karɓa daga Multer (req.file)
 * @returns {Promise<String>} - Yana dawo da URL din hoton da aka loda idan an yi nasara
 */
const uploadToAyax = async (file) => {
  try {
    if (!file) {
      throw new Error("No file provided for upload.");
    }

    const formData = new FormData();
    formData.append("file", file.buffer, {
      filename: file.originalname || `upload-${Date.now()}.png`,
      contentType: file.mimetype || "application/octet-stream",
    });

    const response = await axios.post(`${AYAX_API_BASE_URL}/upload`, formData, {
      headers: {
        ...formData.getHeaders(),
        "x-api-key": AYAX_API_KEY,
        Authorization: `Bearer ${AYAX_API_KEY}`,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 60000, // 60 seconds
    });

    const resData = response.data;
    const isSuccessful =
      resData &&
      (resData.success === true ||
        resData.status === true ||
        resData.status === "success" ||
        resData.code === 200 ||
        resData.code === "200");

    if (isSuccessful) {
      const fileUrl =
        resData.url ||
        resData.fileUrl ||
        resData.file_url ||
        resData.data?.url ||
        resData.data?.fileUrl ||
        resData.data?.file_url;

      if (!fileUrl) {
        throw new Error("File uploaded but no URL returned from storage.");
      }

      return fileUrl;
    } else {
      throw new Error(
        resData?.message || "Failed to upload file to Ayax storage."
      );
    }
  } catch (error) {
    const errorMsg =
      error.response?.data?.message ||
      error.message ||
      "Ayax file upload error.";
    throw new Error(`Ayax Upload Error: ${errorMsg}`);
  }
};

module.exports = { uploadToAyax };