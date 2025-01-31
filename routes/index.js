const express = require('express');
const router = express.Router();
const { ErrorResponse } = require('../middlewares/errorHandler.js');

// Contoh middleware untuk route spesifik
const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// Contoh route dengan error handling
router.get('/test-error/:type', asyncHandler(async (req, res, next) => {
    switch (req.params.type) {
        case 'validation':
            throw new ErrorResponse('Validation failed', 400);
        case 'unauthorized':
            throw new ErrorResponse('Not authorized', 401);
        case 'forbidden':
            throw new ErrorResponse('Forbidden access', 403);
        case 'notfound':
            throw new ErrorResponse('Resource not found', 404);
        case 'server':
            throw new ErrorResponse('Internal server error', 500);
        default:
            res.json({ message: 'Test route working' });
    }
}));

module.exports = router;