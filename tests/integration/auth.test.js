// tests/integration/auth.test.js
const testServer = require('../helpers/testServer');
const User = require('../../models/User');
const { sampleUser } = require('../fixtures/mockData');
const { createAuthHeader, generateAuthToken, createTestUser } = require('../helpers/testUtils');
const path = require('path');

describe('Authentication & User Management', () => {
    beforeEach(async () => {
        await User.deleteMany({});
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
            const imagePath = path.join(__dirname, '../fixtures/test-image.jpg');
            const response = await testServer
                .put(`/api/users/${user._id}`)
                .set(createAuthHeader(token))
                .attach('image', imagePath);

            expect(response.status).toBe(200);
            expect(response.body.data.user).toHaveProperty('imageUrl');
        });
    });
});