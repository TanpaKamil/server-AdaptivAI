// src/routes/index.js
const express = require('express');
const router = express.Router();
const { AppError } = require('../middlewares/errorHandler');
const moduleRoutes = require('./moduleRoutes');
const userRoutes = require('./userRoutes');

// Test routes for error handling
router.get('/test-error/:type', async (req, res, next) => {
    switch (req.params.type) {
        case 'validation':
            return next(new AppError('Validation failed', 400));
        case 'unauthorized':
            return next(new AppError('Not authorized', 401));
        case 'forbidden':
            return next(new AppError('Forbidden access', 403));
        case 'notfound':
            return next(new AppError('Resource not found', 404));
        case 'server':
            return next(new AppError('Internal server error', 500));
        default:
            res.json({ message: 'Test route working' });
    }
});

// Test routes for module features
router.get('/test-module/:feature', async (req, res, next) => {
    try {
        switch (req.params.feature) {
            case 'create':
                // Test module creation without file
                return next(new AppError('PDF file is required', 400));
            
            case 'chapter-generation':
                // Test chapter generation with invalid moduleId
                return next(new AppError('Invalid module ID', 404));
            
            case 'assessment':
                // Test assessment submission with invalid answers
                return next(new AppError('Invalid assessment data', 400));
            
            case 'adaptation':
                // Test adaptation with incomplete progress
                return next(new AppError('Cannot adapt: insufficient data', 400));
            
            default:
                res.json({ message: 'Feature test route working' });
        }
    } catch (error) {
        next(error);
    }
});

router.use((req, res, next) => {
    console.log(`Request URL: ${req.url}`);
    console.log(`Request Method: ${req.method}`);
    next();
});

// Module routes
router.use('/modules', moduleRoutes);
//userRoutes
router.use('/users', userRoutes);

// Generic test route
router.get('/test', (req, res) => {
    res.json({
        message: 'API is working',
        timestamp: new Date(),
        features: [
            'Module Creation',
            'Chapter Generation',
            'Assessment',
            'Adaptive Learning'
        ]
    });
});

module.exports = router;