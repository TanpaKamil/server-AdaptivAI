const authHelper = require('../utils/authHelper');
const { AppError } = require('./errorHandler');

const authenticate = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const token = req.headers.authorization?.split(' ');

    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'No token provided'
      });
    }

    // Verify token
    const decoded = authHelper.verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid token'
    });
  }
};

module.exports = authenticate;