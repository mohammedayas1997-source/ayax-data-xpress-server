const jwt = require("jsonwebtoken");
const User = require("../models/User");

/**
 * @desc    Protect Middleware - Tabbatar mai amfani ya yi login kuma token dinsa yana aiki
 */
const protect = async (req, res, next) => {
  let token;

  // Duba ko akwai Token a cikin Authorization Headers
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies && req.cookies.token) {
    // Tallafawa cookies idan ana amfani da su
    token = req.cookies.token;
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

    // Nemo User ba tare da password ba. Muna amfani da Mongoose document (ba lean ba) 
    // domin ba da damar yin .save() idan an buƙata a gaba a cikin controllers.
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User no longer exists",
      });
    }

    // RIGAKAFIN TSARO: Idan an dakatar da account din user, kar ya iya yin komai
    if (user.isSuspended) {
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended. Please contact support.",
      });
    }

    // Sanya user a cikin req don amfani da shi a gaba
    req.user = user;
    next();
  } catch (error) {
    console.error("Auth Middleware Error:", error.message);
    let message = "Session expired, please login again";
    if (error.name === "JsonWebTokenError") {
      message = "Invalid token, authorization denied";
    } else if (error.name === "TokenExpiredError") {
      message = "Token expired, please login again";
    }

    return res.status(401).json({
      success: false,
      message,
    });
  }
};

/**
 * @desc    Authorize Middleware - Yanke ikon shiga bisa ga matsayi (Roles)
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Unauthorized: Your role (${req.user?.role || "user"}) cannot access this route`,
      });
    }
    next();
  };
};

/**
 * @desc    Admin Only Middleware - Domin tabbatar cewa Admin ko Superadmin ne kawai zai iya shiga
 */
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

module.exports = { protect, authorize, adminOnly };