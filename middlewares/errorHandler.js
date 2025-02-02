// src/middlewares/errorHandler.js

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
      const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
      return new AppError(`Duplicate field value: ${value}. Please use another value`, 400);
    },
  
    JsonWebTokenError: () => 
      new AppError('Invalid token. Please log in again.', 401),
  
    TokenExpiredError: () => 
      new AppError('Your token has expired. Please log in again.', 401)
  };
  
  /**
   * Environment-specific error responses
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
      if (err.isOperational) {
        res.status(err.statusCode).json({
          status: err.status,
          message: err.message
        });
      } else {
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
   * Simplified version that works with bound instance methods
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
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';
  
    const environment = process.env.NODE_ENV || 'development';
    
    if (environment === 'development') {
      errorResponders.development(err, res);
    } else {
      let error = { ...err };
      error.message = err.message;
      
      // Handle specific error types
      if (error.name === 'CastError') {
        error = errorHandlers.CastError(error);
      } else if (error.code === 11000) {
        error = errorHandlers.DuplicateKeyError(error);
      } else if (error.name === 'ValidationError') {
        error = errorHandlers.ValidationError(error);
      } else if (error.name === 'JsonWebTokenError') {
        error = errorHandlers.JsonWebTokenError();
      } else if (error.name === 'TokenExpiredError') {
        error = errorHandlers.TokenExpiredError();
      }
  
      errorResponders.production(error, res);
    }
  };
  
  module.exports = {
    AppError,
    asyncHandler,
    errorHandler
  };