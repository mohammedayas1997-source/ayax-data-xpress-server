const jwt = require("jsonwebtoken");
const User = require("../models/User");

// 1. Protect Middleware (Tabbatar user ya yi login)
const protect = async (req, res, next) => {
  let token;

  // Duba ko akwai Token a cikin Headers
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Please login to access this resource",
    });
  }

  try {
    // Tabbatar Token din na kwarai ne
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Nemo User amma kada mu dauko password dinsa (.select('-password'))
    // Mun yi amfani da .lean() don gudun nauyin data a Vercel
    req.user = await User.findById(decoded.id).select("-password").lean();

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User no longer exists",
      });
    }

    // RIGAKAFIN TSARO: Idan an suspended din user, kar ya iya komai
    if (req.user.isSuspended) {
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended. Please contact support.",
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Session expired, please login again",
    });
  }
};

// 2. Authorize Middleware (Yanke ikon kowane Role)
const authorize = (...roles) => {
  return (req, res, next) => {
    // Tabbatar role din user yana cikin jerin roles din da aka halatta
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Unauthorized: Your role (${req.user?.role || "user"}) cannot access this route`,
      });
    }
    next();
  };
};

// 3. Admin Only (Domin dacewa da kiran da kake yi a sauran routes)
const adminOnly = (req, res, next) => {
  if (
    req.user &&
    (req.user.role === "admin" || req.user.role === "superadmin")
  ) {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: "Access denied: Admins only",
    });
  }
};

// GYARA: Mun fitar da su duka a nan domin sauran files su iya gani
module.exports = { protect, authorize, adminOnly };
