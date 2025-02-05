const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
jest.mock('../config/cloudinary', () => ({
    uploadToCloudinary: jest.fn().mockResolvedValue({ secure_url: 'mocked-url' })
}));
const mongoose = require('mongoose');
const app = require('../app');
const Discussion = require('../models/Discussion');
const User = require('../models/User');
const authHelper = require('../utils/authHelper');
const path = require('path');
const fs = require('fs');

let mongoServer;
let testImagePath;
let testToken;
let testUser;
let testDiscussion;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);

    // Create test image
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
    testImagePath = path.join(uploadsDir, 'test-discussion-image.jpg');
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
    await Discussion.deleteMany({});
    await User.deleteMany({});

    // Create test user
    testUser = await User.create({
        username: 'testuser',
        email: 'test@example.com',
        password: await authHelper.hashPassword('password123')
    });
    testToken = authHelper.generateToken({ id: testUser._id, username: testUser.username });

    // Create test discussion
    testDiscussion = await Discussion.create({
        userId: testUser._id,
        title: 'Test Discussion',
        content: 'Test Content',
        imgUrl: 'test-image-url'
    });
});

describe('Discussion API Endpoints', () => {
    describe('GET /api/discussions', () => {
        it('should get all discussions', async () => {
            const res = await request(app)
                .get('/api/discussions')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it('should handle database errors', async () => {
            jest.spyOn(Discussion, 'find').mockImplementationOnce(() => {
                throw new Error('Database error');
            });

            const res = await request(app)
                .get('/api/discussions')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/discussions', () => {
        it('should create discussion with image', async () => {
            const res = await request(app)
                .post('/api/discussions')
                .set('Authorization', `Bearer ${testToken}`)
                .field('title', 'New Discussion')
                .field('content', 'New Content')
                .attach('image', testImagePath);

            expect(res.status).toBe(201);
            expect(res.body.message).toBe('create');
        });

        it('should fail without required fields', async () => {
            const res = await request(app)
                .post('/api/discussions')
                .set('Authorization', `Bearer ${testToken}`)
                .send({});

            expect(res.status).toBe(400);
        });

        it('should handle image upload failure', async () => {
            const invalidPath = path.join(__dirname, '../uploads/invalid.txt');
            fs.writeFileSync(invalidPath, 'invalid');

            const res = await request(app)
                .post('/api/discussions')
                .set('Authorization', `Bearer ${testToken}`)
                .field('title', 'New Discussion')
                .field('content', 'New Content')
                .attach('image', invalidPath);

            fs.unlinkSync(invalidPath);
            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/discussions/:discussionId', () => {
        it('should get discussion detail', async () => {
            const res = await request(app)
                .get(`/api/discussions/${testDiscussion._id}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body._id.toString()).toBe(testDiscussion._id.toString());
        });

        it('should handle non-existent discussion', async () => {
            const res = await request(app)
                .get(`/api/discussions/${new mongoose.Types.ObjectId()}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(404);
        });
    });

    describe('PUT /api/discussions/:discussionId', () => {
        it('should update discussion', async () => {
            const res = await request(app)
                .put(`/api/discussions/${testDiscussion._id}`)
                .set('Authorization', `Bearer ${testToken}`)
                .field('title', 'Updated Title')
                .field('content', 'Updated Content');

            expect(res.status).toBe(200);
        });

        it('should handle unauthorized update', async () => {
            const otherUser = await User.create({
                username: 'other',
                email: 'other@example.com',
                password: await authHelper.hashPassword('password123')
            });
            const otherToken = authHelper.generateToken({ id: otherUser._id, username: otherUser.username });

            const res = await request(app)
                .put(`/api/discussions/${testDiscussion._id}`)
                .set('Authorization', `Bearer ${otherToken}`)
                .send({ title: 'Updated Title' });

            expect(res.status).toBe(403);
        });
    });

    describe('DELETE /api/discussions/:discussionId', () => {
        it('should delete discussion', async () => {
            const res = await request(app)
                .delete(`/api/discussions/${testDiscussion._id}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            const deletedDiscussion = await Discussion.findById(testDiscussion._id);
            expect(deletedDiscussion).toBeNull();
        });

        it('should handle unauthorized deletion', async () => {
            const otherToken = authHelper.generateToken({ 
                id: new mongoose.Types.ObjectId(), 
                username: 'other' 
            });

            const res = await request(app)
                .delete(`/api/discussions/${testDiscussion._id}`)
                .set('Authorization', `Bearer ${otherToken}`);

            expect(res.status).toBe(403);
        });
    });

    describe('PATCH /api/discussions/:discussionId/likes', () => {
        it('should add like', async () => {
            const res = await request(app)
                .patch(`/api/discussions/${testDiscussion._id}/likes`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
        });

        it('should prevent duplicate likes', async () => {
            await request(app)
                .patch(`/api/discussions/${testDiscussion._id}/likes`)
                .set('Authorization', `Bearer ${testToken}`);

            const res = await request(app)
                .patch(`/api/discussions/${testDiscussion._id}/likes`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(400);
        });
    });

    describe('DELETE /api/discussions/:discussionId/likes/:likesId', () => {
        let likeId;

        beforeEach(async () => {
            const discussion = await Discussion.findById(testDiscussion._id);
            discussion.likes.push({ userId: testUser._id, username: testUser.username });
            await discussion.save();
            likeId = discussion.likes[0]._id;
        });

        it('should remove like', async () => {
            const res = await request(app)
                .delete(`/api/discussions/${testDiscussion._id}/likes/${likeId}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
        });

        it('should handle non-existent like', async () => {
            const res = await request(app)
                .delete(`/api/discussions/${testDiscussion._id}/likes/${new mongoose.Types.ObjectId()}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(404);
        });
    });

    describe('PATCH /api/discussions/:discussionId/comments', () => {
        it('should add comment', async () => {
            const res = await request(app)
                .patch(`/api/discussions/${testDiscussion._id}/comments`)
                .set('Authorization', `Bearer ${testToken}`)
                .send({ content: 'Test Comment' });

            expect(res.status).toBe(200);
        });

        it('should handle missing content', async () => {
            const res = await request(app)
                .patch(`/api/discussions/${testDiscussion._id}/comments`)
                .set('Authorization', `Bearer ${testToken}`)
                .send({});

            expect(res.status).toBe(400);
        });
    });

    describe('DELETE /api/discussions/:discussionId/comments/:commentId', () => {
        let commentId;

        beforeEach(async () => {
            const discussion = await Discussion.findById(testDiscussion._id);
            discussion.comments.push({
                userId: testUser._id,
                username: testUser.username,
                content: 'Test Comment'
            });
            await discussion.save();
            commentId = discussion.comments[0]._id;
        });

        it('should delete comment', async () => {
            const res = await request(app)
                .delete(`/api/discussions/${testDiscussion._id}/comments/${commentId}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
        });

        it('should handle unauthorized comment deletion', async () => {
            const otherToken = authHelper.generateToken({ 
                id: new mongoose.Types.ObjectId(), 
                username: 'other' 
            });

            const res = await request(app)
                .delete(`/api/discussions/${testDiscussion._id}/comments/${commentId}`)
                .set('Authorization', `Bearer ${otherToken}`);

            expect(res.status).toBe(404);
        });
    });

    describe('GET /api/discussions/featured', () => {
        it('should get featured discussions', async () => {
            const res = await request(app)
                .get('/api/discussions/featured')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBeLessThanOrEqual(3);
        });

        it('should handle database errors', async () => {
            jest.spyOn(Discussion, 'find').mockImplementationOnce(() => {
                throw new Error('Database error');
            });

            const res = await request(app)
                .get('/api/discussions/featured')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(500);
        });
    });
});