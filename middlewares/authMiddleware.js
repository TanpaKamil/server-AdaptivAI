// src/middlewares/authMiddleware.js
const authHelper = require('../utils/authHelper');
const { AppError } = require('./errorHandler');

const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new AppError('No token provided', 401);
        }

        const token = authHeader.split(' ')[1];
        const decoded = authHelper.verifyToken(token);

        if (!decoded) {
            throw new AppError('Invalid token', 401);
        }

        // Make sure decoded contains id
        if (!decoded.id) {
            throw new AppError('Invalid token payload', 401);
        }

        // Set user data in request
        req.user = {
            id: decoded.id,
            username: decoded.username
        };

        next();
    } catch (error) {
        next(new AppError(error.message || 'Authentication failed', 401));
    }
};

module.exports = authenticate;