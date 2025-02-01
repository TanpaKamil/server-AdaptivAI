// src/app.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { errorHandler, AppError } = require('./middlewares/errorHandler');
const routes = require('./routes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)){
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Health check route
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'Server is running',
        timestamp: new Date()
    });
});

// API Documentation
app.get('/api-docs', (req, res) => {
    res.json({
        version: '1.0.0',
        endpoints: {
            modules: {
                create: 'POST /api/modules/upload',
                getAll: 'GET /api/modules',
                getOne: 'GET /api/modules/:moduleId',
                generateChapter: 'POST /api/modules/:moduleId/chapters/:chapterId/generate',
                getChapter: 'GET /api/modules/:moduleId/chapters/:chapterId'
            },
            instances: {
                start: 'POST /api/modules/:moduleId/start',
                getProgress: 'GET /api/modules/instance/:instanceId',
                submitAssessment: 'POST /api/modules/instance/:instanceId/submit',
                getNextQuestions: 'GET /api/modules/instance/:instanceId/next-questions'
            }
        }
    });
});

// Routes
app.use('/api', routes);

// Handle 404 - Route not found
app.use((req, res, next) => {
    next(new AppError('Route not found', 404));
});

// Error Handler
app.use(errorHandler);

// MongoDB Connection with retry logic
const connectDB = async (retries = 5) => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB Atlas');
    } catch (error) {
        if (retries > 0) {
            console.log(`Retrying connection... (${retries} attempts left)`);
            setTimeout(() => connectDB(retries - 1), 5000);
        } else {
            console.error('Error connecting to MongoDB:', error);
            process.exit(1);
        }
    }
};

// Start server only after DB connection
const startServer = async () => {
    await connectDB();
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
        console.log(`API Documentation available at http://localhost:${PORT}/api-docs`);
    });
};

startServer();