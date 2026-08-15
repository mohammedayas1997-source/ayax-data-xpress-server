// config/ayaxUpload.js
const axios = require("axios");
const FormData = require("form-data");

const AYAX_API_BASE_URL = process.env.AYAX_API_BASE_URL || "https://api.ayaxapis.com/v1";
const AYAX_API_KEY = process.env.AYAX_API_KEY;

/**
 * Ayyukan loda fayil zuwa sabar ta Ayax APIs
 * @param {Object} file - Fayil din da aka karɓa daga Multers (req.file)
 * @returns {Promise<String>} - Yana dawo da URL din hoton da aka loda idan an yi nasara
 */
const uploadToAyax = async (file) => {
  try {
    if (!file) {
      throw new Error("No file provided for upload.");
    }

    const formData = new FormData();
    // 'file' ko 'image' ya danganta da abin da Ayax API ke buƙata a matsayin sunan field din loda kaya
    formData.append("file", file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });

    const response = await axios.post(`${AYAX_API_BASE_URL}/upload`, formData, {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${AYAX_API_KEY}`,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 60000, // 60 seconds don manyan fayiloli
    });

    if (response.data && (response.data.status === true || response.data.status === "success")) {
      // Daidaita wannan gwargwadon tsarin JSON da Ayax API ke dawo da shi (misali: response.data.url ko response.data.data.file_url)
      return response.data.url || response.data.data?.url;
    } else {
      throw new Error(response.data?.message || "Failed to upload file to Ayax storage.");
    }
  } catch (error) {
    const errorMsg = error.response?.data?.message || error.message || "Ayax file upload error.";
    throw new Error(`Ayax Upload Error: ${errorMsg}`);
  }
};

module.exports = { uploadToAyax };