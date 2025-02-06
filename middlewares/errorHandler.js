// src/middlewares/errorHandler.js
const multer = require('multer');
const fs = require('fs');

/**
 * Custom error class for application-specific errors
 */
class AppError extends Error {
    constructor(message, statusCode = 500) {
        super(message);
        this.statusCode = statusCode;
        this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Error type handlers
 */
const errorHandlers = {
    ValidationError: (err) => {
        const errors = Object.values(err.errors).map(el => el.message);
        return new AppError(`Invalid input data. ${errors.join('. ')}`, 400);
    },

    CastError: (err) => {
        const message = `Invalid ${err.path}: ${err.value}`;
        return new AppError(message, 400);
    },

    DuplicateKeyError: (err) => {
        if (err.keyPattern) {
            const field = Object.keys(err.keyPattern)[0];
            return new AppError(`${field.charAt(0).toUpperCase() + field.slice(1)} already exists`, 400);
        }
        return new AppError('Duplicate field value', 400);
    },

    JsonWebTokenError: () =>
        new AppError('Invalid token. Please log in again.', 401),

    TokenExpiredError: () =>
        new AppError('Your token has expired. Please log in again.', 401),

    // Add Multer error handler
    MulterError: (err) => {
        let message = 'File upload error';
        let statusCode = 400;

        switch (err.code) {
            case 'LIMIT_FILE_SIZE':
                message = 'File size too large';
                break;
            case 'LIMIT_FILE_COUNT':
                message = 'Too many files';
                break;
            case 'LIMIT_UNEXPECTED_FILE':
                message = 'Unexpected file type';
                break;
            case 'LIMIT_FIELD_COUNT':
                message = 'Too many fields';
                break;
        }

        return new AppError(message, statusCode);
    },

    // File validation error handler
    FileValidationError: (err) => {
        return new AppError(err.message || 'Invalid file type', 400);
    }
};

/**
 * Environment-specific error responders
 */
const errorResponders = {
    development: (err, res) => {
        res.status(err.statusCode).json({
            status: err.status,
            error: err,
            message: err.message,
            stack: err.stack
        });
    },

    production: (err, res) => {
        // Operational errors have trusted messages
        if (err.isOperational) {
            res.status(err.statusCode).json({
                status: err.status,
                message: err.message
            });
        } else {
            // Log unknown errors and return generic message
            console.error('ERROR 💥', err);
            res.status(500).json({
                status: 'error',
                message: 'Something went wrong!'
            });
        }
    }
};

/**
 * Wraps controller methods to handle async operations and errors
 */
const asyncHandler = (fn) => {
    if (!fn || typeof fn !== 'function') {
        throw new Error('Handler must be a function');
    }

    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

/**
 * Global error handling middleware
 */
const errorHandler = (err, req, res, next) => {
    // Clean up uploaded file if exists
    if (req.file) {
        try {
            fs.unlinkSync(req.file.path);
        } catch (e) {
            console.error('Error cleaning up file:', e);
        }
    }

    // Ensure default values if not set
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    const environment = process.env.NODE_ENV || 'development';

    // In development, display full error detail
    if (environment === 'development') {
        return errorResponders.development(err, res);
    }

    // In production, clone the error to safely modify it
    let error = Object.assign({}, err);
    error.message = err.message;

    // Handle specific known error types
    if (err instanceof multer.MulterError) {
        error = errorHandlers.MulterError(err);
    } else if (err.message === 'Only PDF files are allowed') {
        // Handle file validation error specifically
        error = new AppError(err.message, 400);
        error.isOperational = true;
    } else if (error.name === 'CastError') {
        error = errorHandlers.CastError(err);
    } else if (error.code === 11000) {
        error = errorHandlers.DuplicateKeyError(err);
    } else if (error.name === 'ValidationError') {
        error = errorHandlers.ValidationError(err);
    } else if (error.name === 'JsonWebTokenError') {
        error = errorHandlers.JsonWebTokenError();
    } else if (error.name === 'TokenExpiredError') {
        error = errorHandlers.TokenExpiredError();
    }

    // If the error was from Multer file filter
    if (err.storageErrors || err.message === 'Only PDF files are allowed') {
        error.statusCode = 400;
        error.isOperational = true;
    }

    errorResponders.production(error, res);
};

module.exports = {
    AppError,
    asyncHandler,
    errorHandler
};