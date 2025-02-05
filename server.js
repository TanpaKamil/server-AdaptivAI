// src/server.js
const mongoose = require('mongoose');
const app = require('./app');

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

// Start server only if not in test environment
if (process.env.NODE_ENV !== 'test') {
    startServer();
}

module.exports = { startServer, connectDB };