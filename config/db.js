const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // When running tests, skip connecting to the external Atlas DB.
    if (process.env.NODE_ENV === 'test') {
      console.log('Test environment detected - skipping Atlas connection.');
      return;
    }

    // Ensure the MongoDB URI is provided
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is not defined in your environment variables.");
    }

    console.log('Connecting to MongoDB Atlas with URI:', process.env.MONGODB_URI);

    // Connect to MongoDB Atlas with recommended options
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;