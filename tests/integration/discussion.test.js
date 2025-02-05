const testServer = require('../helpers/testServer');
const Discussion = require('../../models/Discussion');
const User = require('../../models/User');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs').promises;
const mongoose = require('mongoose');

// Define test user data directly since sampleUser isn't available
const TEST_USER = {
    username: 'testuser',
    email: 'test@example.com',
    password: 'Test123!@#'
};

// Mock cloudinary
jest.mock('cloudinary', () => ({
    v2: {
        config: jest.fn(),
        uploader: {
            upload: jest.fn().mockImplementation((path, options) => {
                return Promise.resolve({
                    secure_url: `https://mockcloud.com/${options.public_id || 'default'}`,
                    public_id: options.public_id || 'default'
                });
            }),
            destroy: jest.fn().mockResolvedValue({ result: 'ok' })
        }
    }
}));

describe('Discussion Integration Tests', () => {
    let token;
    let user;
    let discussionId;
    let commentId;
    let likeId;
    let testImagePath;

    // Helper function to create test image
    async function createTestImage() {
        const testDir = path.join(__dirname, '../fixtures');
        await fs.mkdir(testDir, { recursive: true });

        const jpgHeader = Buffer.from([
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10,
            0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
            0x01, 0x01, 0x00, 0x48, 0x00, 0x48,
            0x00, 0x00
        ]);

        testImagePath = path.join(testDir, 'test-discussion-image.jpg');
        await fs.writeFile(testImagePath, jpgHeader);
        return testImagePath;
    }

    // Helper function to create test user
    async function createTestUser(userData) {
        const user = new User(userData);
        await user.save();
        return user;
    }

    // Helper function to generate auth token
    function generateAuthToken(userId, username) {
        return jwt.sign(
            { id: userId, username: username },
            process.env.JWT_SECRET_KEY || 'test-secret',
            { expiresIn: '1h' }
        );
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
        await Discussion.deleteMany({});
        await User.deleteMany({});

        // Create test user
        user = await createTestUser(TEST_USER);
        token = generateAuthToken(user._id, user.username);

        // Create test image
        await createTestImage();

        // Create test discussion
        const discussion = await Discussion.create({
            userId: user._id,
            title: "Test Discussion",
            content: "Test Content",
            imgUrl: "https://mockcloud.com/test-image.jpg"
        });
        discussionId = discussion._id;

        // Add test comment
        discussion.comments.push({
            userId: user._id,
            username: user.username,
            content: "Test Comment"
        });
        await discussion.save();
        commentId = discussion.comments[0]._id;

        // Add test like
        discussion.likes.push({
            userId: user._id,
            username: user.username
        });
        await discussion.save();
        likeId = discussion.likes[0]._id;
    });

    afterEach(async () => {
        await cleanupTestFiles();
    });

    describe('Discussion CRUD Operations', () => {
        it('should create a new discussion with image', async () => {
            const response = await testServer
                .post('/api/discussions')
                .set('Authorization', `Bearer ${token}`)
                .field('title', 'New Discussion')
                .field('content', 'New Content')
                .attach('image', testImagePath);

            expect(response.status).toBe(201);
            expect(response.body.message).toBe("create");

            const discussion = await Discussion.findOne({ title: 'New Discussion' });
            expect(discussion).toBeDefined();
            expect(discussion.imgUrl).toContain('https://mockcloud.com/');
        });

        it('should get all discussions', async () => {
            const response = await testServer
                .get('/api/discussions')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body)).toBe(true);
            expect(response.body[0].title).toBe('Test Discussion');
        });

        it('should get discussion detail', async () => {
            const response = await testServer
                .get(`/api/discussions/${discussionId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.title).toBe('Test Discussion');
            expect(response.body.comments).toBeDefined();
            expect(response.body.likes).toBeDefined();
        });

        it('should update discussion', async () => {
            const response = await testServer
                .put(`/api/discussions/${discussionId}`)
                .set('Authorization', `Bearer ${token}`)
                .field('title', 'Updated Discussion')
                .field('content', 'Updated Content')
                .attach('image', testImagePath);

            expect(response.status).toBe(200);
            expect(response.body.message).toBe("Topic has been edited");

            const updated = await Discussion.findById(discussionId);
            expect(updated.title).toBe('Updated Discussion');
        });

        it('should delete discussion', async () => {
            const response = await testServer
                .delete(`/api/discussions/${discussionId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.message).toBe("Topic has been deleted");

            const deleted = await Discussion.findById(discussionId);
            expect(deleted).toBeNull();
        });
    });

    describe('Comments Operations', () => {
        it('should add comment to discussion', async () => {
            const response = await testServer
                .patch(`/api/discussions/${discussionId}/comments`)
                .set('Authorization', `Bearer ${token}`)
                .send({
                    content: 'New Comment'
                });

            expect(response.status).toBe(200);
            expect(response.body.message).toBe("Comment has been added");

            const discussion = await Discussion.findById(discussionId);
            const newComment = discussion.comments.find(c => c.content === 'New Comment');
            expect(newComment).toBeDefined();
            expect(newComment.username).toBe(user.username);
            expect(newComment.userId.toString()).toBe(user._id.toString());
        });

        it('should delete comment from discussion', async () => {
            const response = await testServer
                .delete(`/api/discussions/${discussionId}/comments/${commentId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.message).toBe("Comment has been deleted");

            const discussion = await Discussion.findById(discussionId);
            const commentExists = discussion.comments.some(c => c._id.equals(commentId));
            expect(commentExists).toBe(false);
        });
    });

    describe('Likes Operations', () => {
        it('should add like to discussion', async () => {
            // First remove existing like
            await Discussion.findByIdAndUpdate(discussionId,
                { $pull: { likes: { userId: user._id } } },
                { new: true }
            );

            const response = await testServer
                .patch(`/api/discussions/${discussionId}/likes`)
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.message).toBe("Successfully liked topic");

            const discussion = await Discussion.findById(discussionId);
            const like = discussion.likes.find(l => l.userId.toString() === user._id.toString());
            expect(like).toBeDefined();
            expect(like.username).toBe(user.username);
        });

        it('should remove like from discussion', async () => {
            const response = await testServer
                .delete(`/api/discussions/${discussionId}/likes/${likeId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body.message).toBe("Successfully unlike topic");

            const discussion = await Discussion.findById(discussionId);
            const likeExists = discussion.likes.some(l => l._id.equals(likeId));
            expect(likeExists).toBe(false);
        });
    });


    describe('Error Handling', () => {
        it('should handle invalid discussion ID', async () => {
            // Use a valid ObjectId format but one that doesn't exist
            const nonExistentId = new mongoose.Types.ObjectId();

            const response = await testServer
                .get(`/api/discussions/${nonExistentId}`)
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(404);
        });

        it('should prevent unauthorized discussion updates', async () => {
            // Create another user
            const anotherUser = await createTestUser({
                ...TEST_USER,
                username: 'another',
                email: 'another@test.com'
            });
            const anotherToken = generateAuthToken(anotherUser._id, anotherUser.username);

            const response = await testServer
                .put(`/api/discussions/${discussionId}`)
                .set('Authorization', `Bearer ${anotherToken}`)
                .send({
                    title: 'Unauthorized Update',
                    content: 'Should Fail'
                });

            expect(response.status).toBe(403);
        });


        it('should handle duplicate likes', async () => {
            const response = await testServer
                .patch(`/api/discussions/${discussionId}/likes`)
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(400);
            expect(response.body.status).toBe('fail');
        });

        it('should handle missing required fields', async () => {
            const response = await testServer
                .post('/api/discussions')
                .set('Authorization', `Bearer ${token}`)
                .send({});

            expect(response.status).toBe(400);
        });

        it('should handle invalid image uploads', async () => {
            const testDir = path.join(__dirname, '../fixtures');
            const invalidPath = path.join(testDir, 'invalid.txt');
            await fs.writeFile(invalidPath, 'Not an image');

            try {
                const response = await testServer
                    .post('/api/discussions')
                    .set('Authorization', `Bearer ${token}`)
                    .field('title', 'Invalid Image Test')
                    .field('content', 'Test Content')
                    .attach('image', invalidPath);

                expect(response.status).toBe(400);
            } finally {
                await fs.unlink(invalidPath).catch(console.error);
            }
        });
    });
});