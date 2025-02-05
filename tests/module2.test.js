const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const app = require('../app');
const { ModuleMaster } = require('../models/ModuleMaster');
const { ModuleInstance } = require('../models/ModuleInstance');
const User = require('../models/User');
const authHelper = require('../utils/authHelper');

let mongoServer;
let testToken;
let testUser;
let testModule;
let testInstance;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
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
            summaries: [{
                content: 'Summary content',
                comprehensionLevel: 1,
                flashcardFront: 'Front',
                flashcardBack: 'Back'
            }],
            levels: [{
                bloomLevel: 1,
                questions: [{
                    question: 'Test question?',
                    options: ['A', 'B', 'C', 'D'],
                    correctAnswer: 0,
                    explanation: 'Explanation',
                    bloomLevel: 1,
                    difficultyLevel: 1,
                    learningObjective: 'Objective',
                    targetedConcept: 'Concept'
                }]
            }],
            questionSets: [{
                setNumber: 1,
                type: 'initial',
                questionRefs: [{
                    questionId: new mongoose.Types.ObjectId(),
                    bloomLevel: 1,
                    targetedConcept: 'Concept'
                }]
            }]
        }],
        subscribedUsers: [testUser._id],
        uniqueIdentifier: `${testUser._id}_${Date.now()}`
    });

    testInstance = await ModuleInstance.create({
        moduleMasterId: testModule._id,
        userId: testUser._id,
        currentState: {
            currentChapterIndex: 0,
            currentLevelIndex: 0,
            comprehensionScore: 0,
            lastAssessmentLevel: 1,
            currentQuestionSetId: testModule.chapters[0].questionSets[0]._id
        },
        chapterProgress: [{
            chapterIndex: 0,
            status: 'in_progress',
            questionSets: [{
                setId: testModule.chapters[0].questionSets[0]._id,
                setNumber: 1,
                type: 'initial',
                questions: [{
                    questionId: testModule.chapters[0].levels[0].questions[0]._id,
                    status: 'pending'
                }]
            }]
        }]
    });
});

describe('Module API Endpoints - Part 2', () => {
    describe('POST /api/modules/:moduleId/start', () => {
        it('should start a new module instance', async () => {
            const res = await request(app)
                .post(`/api/modules/${testModule._id}/start`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(201);
            expect(res.body.data.instance).toBeDefined();
            expect(res.body.data.instance.userId.toString()).toBe(testUser._id.toString());
        });

        it('should handle non-existent module', async () => {
            const res = await request(app)
                .post(`/api/modules/${new mongoose.Types.ObjectId()}/start`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(404);
        });
    });

    describe('GET /api/modules/instances/:instanceId', () => {
        it('should get instance progress', async () => {
            const res = await request(app)
                .get(`/api/modules/instances/${testInstance._id}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.instance).toBeDefined();
            expect(res.body.data.instance.progress).toBeDefined();
        });

        it('should handle unauthorized access', async () => {
            const otherUser = await User.create({
                username: 'other',
                email: 'other@example.com',
                password: await authHelper.hashPassword('password123')
            });
            const otherToken = authHelper.generateToken({ id: otherUser._id, username: otherUser.username });

            const res = await request(app)
                .get(`/api/modules/instances/${testInstance._id}`)
                .set('Authorization', `Bearer ${otherToken}`);

            expect(res.status).toBe(403);
        });
    });

    describe('GET /api/modules/instances/:instanceId/chapters/:chapterId', () => {
        it('should get chapter content', async () => {
            const chapterId = testModule.chapters[0]._id;

            const res = await request(app)
                .get(`/api/modules/instances/${testInstance._id}/chapters/${chapterId}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.chapter).toBeDefined();
            expect(res.body.data.chapter.content).toBeDefined();
        });

        it('should handle invalid chapter id', async () => {
            const res = await request(app)
                .get(`/api/modules/instances/${testInstance._id}/chapters/${new mongoose.Types.ObjectId()}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(404);
        });
    });

    describe('GET /api/modules/instances/:instanceId/assessment', () => {
        it('should get next questions', async () => {
            const res = await request(app)
                .get(`/api/modules/instances/${testInstance._id}/assessment`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.questions).toBeDefined();
            expect(Array.isArray(res.body.questions)).toBe(true);
        });

        it('should include question metadata', async () => {
            const res = await request(app)
                .get(`/api/modules/instances/${testInstance._id}/assessment`)
                .set('Authorization', `Bearer ${testToken}`);

            const question = res.body.questions[0];
            expect(question.bloomLevel).toBeDefined();
            expect(question.difficultyLevel).toBeDefined();
            expect(question.targetedConcept).toBeDefined();
        });
    });

    describe('PUT /api/modules/instances/:instanceId/assessment', () => {
        it('should update assessment answer', async () => {
            const questionId = testModule.chapters[0].levels[0].questions[0]._id;

            const res = await request(app)
                .put(`/api/modules/instances/${testInstance._id}/assessment`)
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    questionId,
                    userAnswer: 0
                });

            expect(res.status).toBe(200);
        });

        it('should handle invalid question id', async () => {
            const res = await request(app)
                .put(`/api/modules/instances/${testInstance._id}/assessment`)
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    questionId: new mongoose.Types.ObjectId(),
                    userAnswer: 0
                });

            expect(res.status).toBe(404);
        });
    });
});