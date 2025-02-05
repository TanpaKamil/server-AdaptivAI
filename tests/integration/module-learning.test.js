// tests/integration/module-learning.test.js
const testServer = require('../helpers/testServer');
const { ModuleMaster } = require('../../models/ModuleMaster');
const { ModuleInstance } = require('../../models/ModuleInstance');
const User = require('../../models/User');
const { createTestUser, generateAuthToken } = require('../helpers/testUtils');
const { sampleUser } = require('../fixtures/mockData');
const mongoose = require('mongoose');

describe('Module Learning & Assessment Tests', () => {
  let token;
  let user;
  let moduleId;
  let instanceId;
  let chapterId;
  let currentQuestionSetId;

  beforeEach(async () => {
    // Clear previous data
    await ModuleMaster.deleteMany({});
    await ModuleInstance.deleteMany({});
    await User.deleteMany({});

    // Create test user
    user = await createTestUser(User, sampleUser);
    token = generateAuthToken(user._id);

    // Create questions for all Bloom's levels
    const questionsData = [];
    for (let level = 1; level <= 6; level++) {
      for (let i = 0; i < 3; i++) { // Create 3 questions per level
        questionsData.push({
          question: `Test question ${level}-${i}?`,
          options: ["A", "B", "C", "D"],
          correctAnswer: 0,
          explanation: "Test explanation",
          bloomLevel: level,
          difficultyLevel: Math.ceil(level/2),
          learningObjective: "Test objective",
          targetedConcept: `Concept ${level}-${i}`
        });
      }
    }

    // Create module with questions
    const moduleData = {
      title: "Test Module",
      description: "Test Description",
      excerpt: "Test Excerpt",
      createdBy: user._id,
      pdfUrl: "https://test.pdf",
      chapters: [{
        title: "Test Chapter",
        order: 1,
        excerpt: "Test Chapter Excerpt",
        summaries: [{
          content: "Test content",
          comprehensionLevel: 1,
          flashcardFront: "Test front",
          flashcardBack: "Test back",
          relatedConcepts: ["Test concept"],
          practicePrompt: "Test prompt"
        }],
        levels: [{
          bloomLevel: 1,
          questions: questionsData.filter(q => q.bloomLevel === 1)
        }, {
          bloomLevel: 2,
          questions: questionsData.filter(q => q.bloomLevel === 2)
        }, {
          bloomLevel: 3,
          questions: questionsData.filter(q => q.bloomLevel === 3)
        }, {
          bloomLevel: 4,
          questions: questionsData.filter(q => q.bloomLevel === 4)
        }, {
          bloomLevel: 5,
          questions: questionsData.filter(q => q.bloomLevel === 5)
        }, {
          bloomLevel: 6,
          questions: questionsData.filter(q => q.bloomLevel === 6)
        }]
      }]
    };

    const module = await ModuleMaster.create(moduleData);
    moduleId = module._id;
    chapterId = module.chapters[0]._id;

    // Create initial question set
    const questionRefs = [];
    module.chapters[0].levels.forEach(level => {
      level.questions.slice(0, 2).forEach(question => {
        questionRefs.push({
          questionId: question._id,
          bloomLevel: level.bloomLevel
        });
      });
    });

    const questionSet = {
      setNumber: 1,
      type: 'initial',
      questionRefs: questionRefs
    };

    // Add question set to chapter
    const updatedModule = await ModuleMaster.findOneAndUpdate(
      { _id: moduleId, 'chapters._id': chapterId },
      { $push: { 'chapters.$.questionSets': questionSet } },
      { new: true }
    );

    currentQuestionSetId = updatedModule.chapters[0].questionSets[0]._id;

    // Create instance
    const instanceData = {
      moduleMasterId: moduleId,
      userId: user._id,
      currentState: {
        currentChapterIndex: 0,
        currentLevelIndex: 0,
        comprehensionScore: 0,
        lastAssessmentLevel: 1,
        currentQuestionSetId
      },
      chapterProgress: [{
        chapterIndex: 0,
        status: 'in_progress',
        questionSets: [{
          setId: currentQuestionSetId,
          setNumber: 1,
          type: 'initial',
          questions: questionRefs.map(ref => ({
            questionId: ref.questionId,
            status: 'pending'
          }))
        }]
      }]
    };

    const instance = await ModuleInstance.create(instanceData);
    instanceId = instance._id;
  });

  describe('Module Instance Flow', () => {
    it('should start a new module instance', async () => {
      // Delete existing instance first
      await ModuleInstance.deleteMany({ 
        userId: user._id,
        moduleMasterId: moduleId 
      });

      const response = await testServer
        .post(`/api/modules/${moduleId}/start`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(201);
      expect(response.body.data.instance).toBeDefined();
    });

    it('should get chapter content', async () => {
      const response = await testServer
        .get(`/api/modules/instances/${instanceId}/chapters/${chapterId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.chapter).toBeDefined();
    });

    it('should get next assessment questions', async () => {
      const response = await testServer
        .get(`/api/modules/instances/${instanceId}/assessment`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(201);
      expect(response.body.data.questions).toBeDefined();
    });

    it('should submit an answer', async () => {
      const instance = await ModuleInstance.findById(instanceId);
      const questionId = instance.chapterProgress[0].questionSets[0].questions[0].questionId;

      const response = await testServer
        .put(`/api/modules/instances/${instanceId}/assessment`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          questionId: questionId.toString(),
          userAnswer: 0
        });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('success');
    });

    it('should get instance progress', async () => {
      const response = await testServer
        .get(`/api/modules/instances/${instanceId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.instance).toBeDefined();
    });

    it('should get learning feedback', async () => {
      const response = await testServer
        .get(`/api/modules/instances/${instanceId}/chapters/${chapterId}/feedbacks`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.feedback).toBeDefined();
    });
  });
});