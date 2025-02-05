// tests/integration/auth.test.js
const testServer = require('../helpers/testServer');
const User = require('../../models/User');
const { sampleUser } = require('../fixtures/mockData');
const { createAuthHeader, generateAuthToken, createTestUser } = require('../helpers/testUtils');
const path = require('path');
const fs = require('fs').promises;

describe('Authentication & User Management', () => {
    let testImagePath;

    // Helper function to create test image
    async function createTestImage() {
        const testDir = path.join(__dirname, '../fixtures');
        await fs.mkdir(testDir, { recursive: true });
        
        // Create a minimal valid JPEG file
        const jpgHeader = Buffer.from([
            0xFF, 0xD8,                // SOI marker
            0xFF, 0xE0,                // APP0 marker
            0x00, 0x10,                // Length of APP0 block
            0x4A, 0x46, 0x49, 0x46, 0x00, // "JFIF" marker
            0x01, 0x01,                // Version
            0x00,                      // Units
            0x00, 0x01,                // X density
            0x00, 0x01,                // Y density
            0x00, 0x00                 // Thumbnail
        ]);

        testImagePath = path.join(testDir, 'test-image.jpg');
        await fs.writeFile(testImagePath, jpgHeader);
        return testImagePath;
    }

    // Cleanup helper
    async function cleanupTestFiles() {
        if (testImagePath) {
            try {
                await fs.unlink(testImagePath);
                testImagePath = null;
            } catch (error) {
                console.warn('Error cleaning up test image:', error);
            }
        }
    }

    beforeEach(async () => {
        await User.deleteMany({});
    });

    afterEach(async () => {
        await cleanupTestFiles();
    });

    describe('POST /api/users/register', () => {
        it('should register a new user successfully', async () => {
            const response = await testServer
                .post('/api/users/register')
                .send(sampleUser);

            expect(response.status).toBe(201);
            expect(response.body.status).toBe('success');

            const user = await User.findOne({ email: sampleUser.email });
            expect(user).toBeTruthy();
            expect(user.username).toBe(sampleUser.username);
        });

        it('should not register user with existing email', async () => {
            await createTestUser(User, sampleUser);

            const response = await testServer
                .post('/api/users/register')
                .send(sampleUser);

            expect(response.status).toBe(400);
            expect(response.body.status).toBe('fail');
        });
    });

    describe('POST /api/users/login', () => {
        beforeEach(async () => {
            await createTestUser(User, sampleUser);
        });

        it('should login successfully with correct credentials', async () => {
            const response = await testServer
                .post('/api/users/login')
                .send({
                    email: sampleUser.email,
                    password: sampleUser.password
                });

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('token');
        });

        it('should not login with incorrect password', async () => {
            const response = await testServer
                .post('/api/users/login')
                .send({
                    email: sampleUser.email,
                    password: 'wrongpassword'
                });

            expect(response.status).toBe(401);
        });
    });

    describe('Authentication Middleware', () => {
        let token;
        let user;

        beforeEach(async () => {
            user = await createTestUser(User, sampleUser);
            token = generateAuthToken(user._id);
        });

        it('should allow access to protected route with valid token', async () => {
            const response = await testServer
                .get(`/api/users/${user._id}`)
                .set(createAuthHeader(token));

            expect(response.status).toBe(200);
        });

        it('should deny access without token', async () => {
            const response = await testServer
                .get(`/api/users/${user._id}`);

            expect(response.status).toBe(401);
        });

        it('should deny access with invalid token', async () => {
            const response = await testServer
                .get(`/api/users/${user._id}`)
                .set(createAuthHeader('invalid-token'));

            expect(response.status).toBe(401);
        });
    });

    describe('User Profile Management', () => {
        let token;
        let user;

        beforeEach(async () => {
            user = await createTestUser(User, sampleUser);
            token = generateAuthToken(user._id);
        });

        it('should update user profile successfully', async () => {
            const updatedData = {
                username: 'updateduser'
            };

            const response = await testServer
                .put(`/api/users/${user._id}`)
                .set(createAuthHeader(token))
                .send(updatedData);

            expect(response.status).toBe(200);
            expect(response.body.data.user.username).toBe(updatedData.username);

            const updatedUser = await User.findById(user._id);
            expect(updatedUser.username).toBe(updatedData.username);
        });

        it('should handle profile image upload', async () => {
            // Create test image before upload
            const imagePath = await createTestImage();

            const response = await testServer
                .put(`/api/users/${user._id}`)
                .set(createAuthHeader(token))
                .attach('image', imagePath);

            expect(response.status).toBe(200);
            expect(response.body.data.user.imageUrl).toBeDefined();
        });

        it('should reject invalid file types', async () => {
            // Create an invalid file
            const testDir = path.join(__dirname, '../fixtures');
            const invalidPath = path.join(testDir, 'invalid.txt');
            await fs.mkdir(testDir, { recursive: true });
            await fs.writeFile(invalidPath, 'Not an image');

            try {
                const response = await testServer
                    .put(`/api/users/${user._id}`)
                    .set(createAuthHeader(token))
                    .attach('image', invalidPath);

                expect(response.status).toBe(400);
            } finally {
                // Cleanup invalid file
                await fs.unlink(invalidPath).catch(console.error);
            }
        });
    });
});