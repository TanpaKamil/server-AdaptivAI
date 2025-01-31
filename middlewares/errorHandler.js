class ErrorResponse extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
    }
}

const errorHandler = (err, req, res, next) => {
    let error = { ...err };
    error.message = err.message;

    // Log error untuk development
    console.log(err.stack);

    switch (err.name) {
        case 'CastError':
            error.message = 'Resource not found';
            error.statusCode = 404;
            break;

        case 'ValidationError':
            error.message = Object.values(err.errors).map(val => val.message);
            error.statusCode = 400;
            break;

        case 'MongoServerError':
            if (err.code === 11000) {
                error.message = 'Duplicate field value entered';
                error.statusCode = 400;
            }
            break;

        case 'JsonWebTokenError':
            error.message = 'Not authorized';
            error.statusCode = 401;
            break;

        case 'TokenExpiredError':
            error.message = 'Token expired';
            error.statusCode = 401;
            break;

        default:
            switch (err.statusCode) {
                case 400:
                    error.message = error.message || 'Bad Request';
                    break;
                case 401:
                    error.message = error.message || 'Not authorized';
                    break;
                case 403:
                    error.message = error.message || 'Forbidden';
                    break;
                case 404:
                    error.message = error.message || 'Resource not found';
                    break;
                case 429:
                    error.message = error.message || 'Too many requests';
                    break;
                default:
                    error.statusCode = 500;
                    error.message = error.message || 'Server Error';
            }
    }

    res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Server Error'
    });
};

module.exports = {
    ErrorResponse,
    errorHandler
};