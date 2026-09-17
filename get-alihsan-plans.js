const axios = require("axios");

async function checkPlans() {
  try {
    const res = await axios.get("https://alihsandatasub.com.ng/api/v1/plan.php", {
      headers: {
        Authorization: "BvpQJPXh5zmSnmUtL096qWV6BXYbhltOud2H2YPGjJnxINhm6x",
      },
    });
    console.log("Al-Ihsan Plans:", JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
  }
}

checkPlans();