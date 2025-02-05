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

    // Mock AI responses
    jest.mock('@google/generative-ai', () => ({
        GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
            getGenerativeModel: jest.fn().mockReturnValue({
                generateContent: jest.fn().mockResolvedValue({
                    response: { text: () => JSON.stringify({
                        title: "Test Module",
                        description: "Test Description",
                        excerpt: "Test Excerpt",
                        chapters: [{
                            title: "Chapter 1",
                            order: 1,
                            excerpt: "Test Chapter"
                        }]
                    })}
                })
            })
        }))
    }));

    // Mock moduleService
    jest.mock('../services/moduleService', () => ({
        ...jest.requireActual('../services/moduleService'),
        getPDFContent: jest.fn().mockResolvedValue('mockedBase64PDFContent'),
        evaluateAndAdapt: jest.fn().mockResolvedValue({
            evaluation: {
                score: 85,
                recommendedLevel: 2,
                weakAreas: [],
                strengths: [],
                needsAdaptation: false,
                adaptationType: 'level_up'
            },
            adaptiveContent: {
                questions: [],
                flashcardIds: []
            }
        })
    }));

    // Mock axios
    jest.mock('axios', () => ({
        get: jest.fn().mockResolvedValue({
            data: Buffer.from('mockPDFContent'),
            status: 200
        })
    }));

    // Mock aiResponseHelper
    jest.mock('../utils/aiResponseHelper', () => ({
        processAIResponse: jest.fn().mockImplementation((text, type) => {
            const mockResponses = {
                metadata: {
                    title: "Test Module",
                    description: "Test Description",
                    excerpt: "Test Excerpt"
                },
                chapters: [{
                    title: "Chapter 1",
                    order: 1,
                    excerpt: "Test Chapter"
                }],
                questions: [{
                    question: "Test question?",
                    options: ["A", "B", "C", "D"],
                    correctAnswer: 0,
                    bloomLevel: 1,
                    difficultyLevel: 1,
                    learningObjective: "Test objective",
                    targetedConcept: "Test concept"
                }],
                flashcards: [{
                    content: "Test content",
                    comprehensionLevel: 1,
                    flashcardFront: "Test front",
                    flashcardBack: "Test back"
                }]
            };
            return mockResponses[type] || {};
        })
    }));
});

// Clean the database between tests
afterEach(async () => {
    if (mongoose.connection.readyState !== 0) {
        const collections = mongoose.connection.collections;
        for (const key in collections) {
            await collections[key].deleteMany();
        }
    }
});

// Cleanup after all tests
afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
        await mongoServer.stop();
    }
});