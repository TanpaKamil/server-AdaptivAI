const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const app = require('../app');
const { ModuleMaster } = require('../models/ModuleMaster');
const { ModuleInstance } = require('../models/ModuleInstance');
const User = require('../models/User');
const authHelper = require('../utils/authHelper');
const path = require('path');
const fs = require('fs');

jest.mock('../config/cloudinary', () => ({
    uploadToCloudinary: jest.fn().mockResolvedValue({ secure_url: 'mocked-url' })
}));

let mongoServer;
let testPdfPath;
let testToken;
let testUser;
let testModule;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);

    // Create test PDF
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
    testPdfPath = path.join(uploadsDir, 'test-module.pdf');
    fs.writeFileSync(testPdfPath, 'test pdf content');
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
    if (fs.existsSync(testPdfPath)) {
        fs.unlinkSync(testPdfPath);
    }
});

beforeEach(async () => {
    await ModuleMaster.deleteMany({});
    await ModuleInstance.deleteMany({});
    await User.deleteMany({});

    testUser = await User.create({
        username: 'testuser',
        email: 'test@example.com',
        password: await authHelper.hashPassword('password123')
    });
    testToken = authHelper.generateToken({ id: testUser._id, username: testUser.username });

    testModule = await ModuleMaster.create({
        title: 'Test Module',
        description: 'Test Description',
        excerpt: 'Test Excerpt',
        createdBy: testUser._id,
        pdfUrl: 'test-pdf-url',
        status: 'completed',
        chapters: [{
            title: 'Chapter 1',
            order: 1,
            excerpt: 'Chapter 1 Excerpt',
            summaries: [],
            levels: []
        }],
        subscribedUsers: [testUser._id],
        uniqueIdentifier: `${testUser._id}_${Date.now()}`
    });
});

describe('Module API Endpoints - Part 1', () => {
    describe('POST /api/modules', () => {
        it('should create a new module', async () => {
            const res = await request(app)
                .post('/api/modules')
                .set('Authorization', `Bearer ${testToken}`)
                .attach('pdf', testPdfPath)
                .field('title', 'New Module')
                .field('description', 'New Description');

            expect(res.status).toBe(201);
            expect(res.body.status).toBe('success');
            expect(res.body.data.moduleId).toBeDefined();
        });

        it('should fail without PDF file', async () => {
            const res = await request(app)
                .post('/api/modules')
                .set('Authorization', `Bearer ${testToken}`)
                .field('title', 'New Module');

            expect(res.status).toBe(400);
        });

        it('should handle invalid file type', async () => {
            const invalidPath = path.join(__dirname, '../uploads/test.txt');
            fs.writeFileSync(invalidPath, 'invalid');

            const res = await request(app)
                .post('/api/modules')
                .set('Authorization', `Bearer ${testToken}`)
                .attach('pdf', invalidPath);

            fs.unlinkSync(invalidPath);
            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/modules', () => {
        it('should get all modules', async () => {
            const res = await request(app)
                .get('/api/modules')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data.modules)).toBe(true);
        });

        it('should handle database errors', async () => {
            jest.spyOn(ModuleMaster, 'find').mockImplementationOnce(() => {
                throw new Error('Database error');
            });

            const res = await request(app)
                .get('/api/modules')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(500);
        });
    });

    describe('GET /api/modules/:moduleId', () => {
        it('should get module details', async () => {
            const res = await request(app)
                .get(`/api/modules/${testModule._id}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.module._id.toString()).toBe(testModule._id.toString());
        });

        it('should handle non-existent module', async () => {
            const res = await request(app)
                .get(`/api/modules/${new mongoose.Types.ObjectId()}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(404);
        });
    });

    describe('GET /api/modules/:moduleId/status', () => {
        it('should get module status', async () => {
            const res = await request(app)
                .get(`/api/modules/${testModule._id}/status`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.status).toBe('completed');
        });

        it('should handle missing module', async () => {
            const res = await request(app)
                .get(`/api/modules/${new mongoose.Types.ObjectId()}/status`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(404);
        });
    });

    describe('GET /api/modules/pub/featured', () => {
        it('should get featured public modules', async () => {
            const res = await request(app)
                .get('/api/modules/pub/featured');

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data.modules)).toBe(true);
        });

        it('should limit featured modules to 3', async () => {
            // Create multiple modules
            await Promise.all([1, 2, 3, 4].map(i => 
                ModuleMaster.create({
                    title: `Module ${i}`,
                    description: 'Description',
                    excerpt: 'Excerpt',
                    createdBy: testUser._id,
                    pdfUrl: 'url',
                    isActive: true,
                    uniqueIdentifier: `${testUser._id}_${Date.now()}_${i}`
                })
            ));

            const res = await request(app)
                .get('/api/modules/pub/featured');

            expect(res.body.data.modules.length).toBeLessThanOrEqual(3);
        });
    });
});