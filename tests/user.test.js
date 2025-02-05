const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const authHelper = require('../utils/authHelper');
const path = require('path');
const fs = require('fs');

let mongoServer;
let testImagePath;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);

    // Create test image file
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
    testImagePath = path.join(uploadsDir, 'test-image.jpg');
    fs.writeFileSync(testImagePath, 'test image content');
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
    if (fs.existsSync(testImagePath)) {
        fs.unlinkSync(testImagePath);
    }
});

beforeEach(async () => {
    await User.deleteMany({});
});

describe('User API Endpoints', () => {
    const testUser = {
        username: 'testuser123',
        email: 'test@example.com',
        password: 'password123'
    };

    describe('POST /api/users/register', () => {
        it('should register a new user with default values', async () => {
            const res = await request(app)
                .post('/api/users/register')
                .send({
                    email: 'minimal@example.com',
                    password: 'password123'
                });

            expect(res.status).toBe(201);
            const user = await User.findOne({ email: 'minimal@example.com' });
            expect(user.username).toBeDefined();
            expect(user.imageUrl).toBeDefined();
        });

        it('should fail with invalid password length', async () => {
            const res = await request(app)
                .post('/api/users/register')
                .send({
                    ...testUser,
                    password: '123' // Too short password
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Password must be at least 6 characters');
        });
    });

    describe('POST /api/users/login', () => {
        beforeEach(async () => {
            const hashedPassword = await authHelper.hashPassword(testUser.password);
            await User.create({ ...testUser, password: hashedPassword });
        });

        it('should fail with missing credentials', async () => {
            const res = await request(app)
                .post('/api/users/login')
                .send({});

            expect(res.status).toBe(404);
        });

        it('should handle server errors gracefully', async () => {
            jest.spyOn(User, 'findOne').mockImplementationOnce(() => {
                throw new Error('Database error');
            });

            const res = await request(app)
                .post('/api/users/login')
                .send(testUser);

            expect(res.status).toBe(500);
        });
    });

    describe('PUT /api/users/:userId', () => {
        let token;
        let userId;
        let adminToken;

        beforeEach(async () => {
            const hashedPassword = await authHelper.hashPassword(testUser.password);
            const user = await User.create({ ...testUser, password: hashedPassword });
            const admin = await User.create({
                username: 'admin',
                email: 'admin@example.com',
                password: hashedPassword,
                role: 'admin'
            });

            token = authHelper.generateToken({ id: user._id, username: user.username });
            adminToken = authHelper.generateToken({ id: admin._id, username: admin.username });
            userId = user._id;
        });

        it('should update user with image upload', async () => {
            const res = await request(app)
                .put(`/api/users/${userId}`)
                .set('Authorization', `Bearer ${token}`)
                .attach('image', testImagePath)
                .field('username', 'newusername');

            expect(res.status).toBe(200);
            expect(res.body.data.user.username).toBe('newusername');
            expect(res.body.data.user.imageUrl).toBeDefined();
        });

        it('should handle invalid file upload', async () => {
            const invalidFilePath = path.join(__dirname, '../uploads/test.txt');
            fs.writeFileSync(invalidFilePath, 'invalid file');

            const res = await request(app)
                .put(`/api/users/${userId}`)
                .set('Authorization', `Bearer ${token}`)
                .attach('image', invalidFilePath);

            fs.unlinkSync(invalidFilePath);
            expect(res.status).toBe(400);
        });

        it('should handle password update', async () => {
            const res = await request(app)
                .put(`/api/users/${userId}`)
                .set('Authorization', `Bearer ${token}`)
                .send({
                    password: 'newpassword123'
                });

            expect(res.status).toBe(200);
            const updatedUser = await User.findById(userId);
            const passwordMatch = await authHelper.comparePassword('newpassword123', updatedUser.password);
            expect(passwordMatch).toBe(true);
        });
    });

    describe('GET /api/users/profile', () => {
        let token;

        beforeEach(async () => {
            const hashedPassword = await authHelper.hashPassword(testUser.password);
            const user = await User.create({
                ...testUser,
                password: hashedPassword,
                modules: [new mongoose.Types.ObjectId()]
            });
            token = authHelper.generateToken({ id: user._id, username: user.username });
        });

        it('should get complete user profile with modules', async () => {
            const res = await request(app)
                .get('/api/users/profile')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(200);
            expect(res.body.data.user).toHaveProperty('modules');
            expect(res.body.data.user).toHaveProperty('lastActive');
            expect(res.body.data.user).not.toHaveProperty('password');
        });

        it('should handle database errors', async () => {
            jest.spyOn(User, 'findById').mockImplementationOnce(() => {
                throw new Error('Database error');
            });

            const res = await request(app)
                .get('/api/users/profile')
                .set('Authorization', `Bearer ${token}`);

            expect(res.status).toBe(500);
        });
    });
});