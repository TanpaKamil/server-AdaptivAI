// tests/setup.js
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const cloudinary = require('cloudinary').v2;
const path = require('path');
const fs = require('fs');

let mongoServer;

// Setup before all tests
beforeAll(async () => {
  // First, close any existing connections
  await mongoose.disconnect();
  
  // Setup MongoDB Memory Server
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  
  // Connect to the in-memory database
  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });

  // Setup test uploads directory
  const uploadDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  // Mock Cloudinary
  cloudinary.uploader.upload = jest.fn().mockImplementation((path, options) => {
    return Promise.resolve({
      secure_url: `https://mockcloud.com/${options.public_id || 'default'}`,
      public_id: options.public_id || 'default'
    });
  });

  // Mock Gemini AI
  jest.mock('@google/generative-ai', () => ({
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: jest.fn().mockReturnValue({
        generateContent: jest.fn().mockResolvedValue({
          response: { text: () => '{"result": "mock response"}' }
        })
      })
    }))
  }));
});

// Cleanup after all tests
afterAll(async () => {
  // Disconnect and stop the server
  await mongoose.disconnect();
  await mongoServer.stop();
});

// Clean the database between tests
afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany();
  }
});