const jwt = require("jsonwebtoken");
const User = require("../models/User");

/**
 * @desc Protect Middleware - Tabbatar mai amfani ya yi login kuma token dinsa yana aiki
 */
const protect = async (req, res, next) => {
  let token;

  // 1. Duba ko akwai Token a cikin Authorization Headers ko Cookies
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.headers.token) {
    token = req.headers.token;
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Please login to access this resource",
    });
  }

  try {
    const jwtSecret =
      process.env.JWT_SECRET ||
      "d5a8161f29822be327aedda003ae85cfbefd1506d280761cd0b068108d678c7d24554eecd936e61855947d34b0947402b9fedd098c8b1bd2247928449eb6b8e6";

    const decoded = jwt.verify(token, jwtSecret);

    // ✅ Tabbatar da gano ID ta kowace hanya (id, _id, userId, ko sub)
    const targetUserId =
      decoded.id ||
      decoded._id ||
      decoded.userId ||
      decoded.user?._id ||
      decoded.user?.id ||
      decoded.sub;

    if (!targetUserId) {
      return res.status(401).json({
        success: false,
        message: "Invalid session token: User ID missing in payload",
      });
    }

    const user = await User.findById(targetUserId).select("-password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User session invalid: Account no longer exists",
      });
    }

    // Tabbatar da matsayin SuperAdmin idan asusun mamallaki ne
    const isOwner =
      user.phone === "09033738409" ||
      String(user.email).toLowerCase() === "mohammed.ayas@ayaxdata.online";

    if (isOwner && user.role !== "superadmin") {
      user.role = "superadmin";
    }

    // Duba idan an dakatar da asusun (Suspended Check)
    if (user.isSuspended && !isOwner) {
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended. Please contact support.",
      });
    }

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
 * @desc Authorize Middleware
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User session missing",
      });
    }

    const userRole = String(req.user.role || "user").toLowerCase().trim();
    const isOwner =
      req.user.phone === "09033738409" ||
      String(req.user.email).toLowerCase() === "mohammed.ayas@ayaxdata.online";

    if (userRole === "superadmin" || isOwner) {
      return next();
    }

    const normalizedAllowedRoles = roles.map((r) =>
      String(r).toLowerCase().trim()
    );

    if (normalizedAllowedRoles.includes(userRole)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: `Unauthorized: Your role (${req.user.role || "user"}) cannot access this route`,
    });
  };
};

/**
 * @desc Admin Only Middleware
 */
const adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Authentication required" });
  }

  const userRole = String(req.user.role || "").toLowerCase().trim();
  const isOwner =
    req.user.phone === "09033738409" ||
    String(req.user.email).toLowerCase() === "mohammed.ayas@ayaxdata.online";

  if (userRole === "admin" || userRole === "superadmin" || isOwner) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "Access denied: Admins and SuperAdmins only",
  });
};

module.exports = { protect, authorize, adminOnly };