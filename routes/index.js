const express = require('express');
const router = express.Router();
const { ErrorResponse } = require('../middlewares/errorHandler.js');

// Middleware for handling async routes
const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// Modified route to use next(error) instead of throwing
router.get('/test-error/:type', asyncHandler(async (req, res, next) => {
    switch (req.params.type) {
        case 'validation':
            return next(new ErrorResponse('Validation failed', 400));
        case 'unauthorized':
            return next(new ErrorResponse('Not authorized', 401));
        case 'forbidden':
            return next(new ErrorResponse('Forbidden access', 403));
        case 'notfound':
            return next(new ErrorResponse('Resource not found', 404));
        case 'server':
            return next(new ErrorResponse('Internal server error', 500));
        default:
            res.json({ message: 'Test route working' });
    }
}));

module.exports = router;