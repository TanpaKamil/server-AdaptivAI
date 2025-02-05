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
        }],
        adaptiveHistory: [{
            timestamp: new Date(),
            previousLevel: 1,
            newLevel: 2,
            assessmentScore: 85,
            understandingAnalysis: {
                strengths: [{
                    topic: 'Concept',
                    bloomLevel: 1,
                    demonstratedSkills: ['Skill']
                }],
                weakAreas: []
            },
            adaptationDetails: {
                adaptationType: 'level_up',
                focusAreas: ['Concept'],
                recommendedApproach: 'Progress'
            }
        }]
    });
});

describe('Module API Endpoints - Part 3', () => {
    describe('GET /api/modules/instances/:instanceId/chapters/:chapterId/feedbacks', () => {
        it('should get chapter feedbacks', async () => {
            const chapterId = testModule.chapters[0]._id;

            const res = await request(app)
                .get(`/api/modules/instances/${testInstance._id}/chapters/${chapterId}/feedbacks`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.feedback).toBeDefined();
            expect(res.body.data.feedback.understandingAnalysis).toBeDefined();
        });

        it('should handle unauthorized access', async () => {
            const otherToken = authHelper.generateToken({ 
                id: new mongoose.Types.ObjectId(), 
                username: 'other'
            });

            const res = await request(app)
                .get(`/api/modules/instances/${testInstance._id}/chapters/${testModule.chapters[0]._id}/feedbacks`)
                .set('Authorization', `Bearer ${otherToken}`);

            expect(res.status).toBe(403);
        });
    });

    describe('POST /api/modules/instances/:instanceId/assessment', () => {
        it('should submit assessment and receive adaptation', async () => {
            const questionId = testModule.chapters[0].levels[0].questions[0]._id;

            const res = await request(app)
                .post(`/api/modules/instances/${testInstance._id}/assessment`)
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    answers: [{
                        questionId,
                        selectedOption: 0
                    }],
                    preferredLanguage: 'en'
                });

            expect(res.status).toBe(200);
            expect(res.body.data.evaluation).toBeDefined();
            expect(res.body.data.evaluation.score).toBeDefined();
        });

        it('should handle assessment submission with no answers', async () => {
            const res = await request(app)
                .post(`/api/modules/instances/${testInstance._id}/assessment`)
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    answers: [],
                    preferredLanguage: 'en'
                });

            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/modules/instances/:instanceId/chapters/:chapterId/questions/:questionId', () => {
        it('should get question details', async () => {
            const chapterId = testModule.chapters[0]._id;
            const questionId = testModule.chapters[0].levels[0].questions[0]._id;

            const res = await request(app)
                .get(`/api/modules/instances/${testInstance._id}/chapters/${chapterId}/questions/${questionId}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.question).toBeDefined();
            expect(res.body.data.question.questionText).toBeDefined();
            expect(res.body.data.question.options).toBeDefined();
        });

        it('should handle non-existent question', async () => {
            const chapterId = testModule.chapters[0]._id;
            
            const res = await request(app)
                .get(`/api/modules/instances/${testInstance._id}/chapters/${chapterId}/questions/${new mongoose.Types.ObjectId()}`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(404);
        });
    });

    describe('GET /api/modules/dashboard', () => {
        it('should get dashboard modules', async () => {
            const res = await request(app)
                .get('/api/modules/dashboard')
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data.modules)).toBe(true);
        });

        it('should include progress information', async () => {
            const res = await request(app)
                .get('/api/modules/dashboard')
                .set('Authorization', `Bearer ${testToken}`);

            const module = res.body.data.modules[0];
            expect(module.progress).toBeDefined();
            expect(module.totalChapters).toBeDefined();
            expect(module.completedChapters).toBeDefined();
        });
    });

    describe('GET /api/modules/instances/:instanceId/chapters/:chapterId/levels', () => {
        it('should get chapter levels', async () => {
            const chapterId = testModule.chapters[0]._id;

            const res = await request(app)
                .get(`/api/modules/instances/${testInstance._id}/chapters/${chapterId}/levels`)
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.levels).toBeDefined();
            expect(res.body.data.filters).toBeDefined();
        });

        it('should support bloom level filtering', async () => {
            const chapterId = testModule.chapters[0]._id;

            const res = await request(app)
                .get(`/api/modules/instances/${testInstance._id}/chapters/${chapterId}/levels`)
                .query({ bloomLevel: 1 })
                .set('Authorization', `Bearer ${testToken}`);

            expect(res.status).toBe(200);
            expect(res.body.data.filters.bloomLevel).toBe(1);
        });
    });
});