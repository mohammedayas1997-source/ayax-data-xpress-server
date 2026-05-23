const bcrypt = require("bcryptjs");

const generateHash = async () => {
  const password = "Ayax@2026";
  const salt = await bcrypt.genSalt(12);
  const hash = await bcrypt.hash(password, salt);

  console.log("-----------------------------------------");
  console.log("COPY THIS HASH:");
  console.log(hash);
  console.log("-----------------------------------------");
};

generateHash();
