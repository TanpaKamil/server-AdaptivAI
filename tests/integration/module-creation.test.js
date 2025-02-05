// tests/integration/module-creation.test.js
const path = require('path');
const testServer = require('../helpers/testServer');
const { ModuleMaster } = require('../../models/ModuleMaster');
const { ModuleInstance } = require('../../models/ModuleInstance');
const User = require('../../models/User');
const { createTestUser, generateAuthToken } = require('../helpers/testUtils');
const { sampleUser } = require('../fixtures/mockData');
const fs = require('fs');

// Mock the AI response helper
jest.mock('../../utils/aiResponseHelper', () => ({
  processAIResponse: (text, type) => {
    if (type === 'metadata') {
      return {
        title: "Test Module",
        description: "Test Description",
        excerpt: "Test Excerpt"
      };
    }
    if (type === 'chapters') {
      return [{
        title: "Chapter 1",
        order: 1,
        excerpt: "Chapter 1 Excerpt"
      }];
    }
    if (type === 'flashcards') {
      return [{
        content: "Test Content",
        comprehensionLevel: 1,
        flashcardFront: "Test Front",
        flashcardBack: "Test Back",
        relatedConcepts: ["concept1"],
        practicePrompt: "Test prompt"
      }];
    }
    if (type === 'questions') {
      return [{
        question: "Test question?",
        options: ["A", "B", "C", "D"],
        correctAnswer: 0,
        explanation: "Test explanation",
        bloomLevel: 1,
        difficultyLevel: 1,
        learningObjective: "Test objective",
        targetedConcept: "Test concept"
      }];
    }
    return null;
  }
}));

// Mock Gemini AI
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn().mockResolvedValue({
        response: {
          text: () => JSON.stringify({
            chapters: [{
              title: "Chapter 1",
              order: 1,
              excerpt: "Chapter 1 Excerpt"
            }]
          })
        }
      })
    })
  }))
}));

describe('Module Creation & Management Tests', () => {
  let token;
  let user;
  const testTimeout = 30000;

  beforeAll(async () => {
    user = await createTestUser(User, sampleUser);
    token = generateAuthToken(user._id);

    // Create uploads directory if it doesn't exist
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Create test PDF
    const pdfPath = path.join(__dirname, '../fixtures/test.pdf');
    if (!fs.existsSync(pdfPath)) {
      const minimalPDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000052 00000 n
0000000101 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
176
%%EOF`;
      fs.writeFileSync(pdfPath, minimalPDF);
    }
  });

  beforeEach(async () => {
    await ModuleMaster.deleteMany({});
    await ModuleInstance.deleteMany({});
  });

  describe('Module creation with PDF upload', () => {
    it('should create a ModuleMaster and a ModuleInstance upon PDF upload', async () => {
      const pdfPath = path.join(__dirname, '../fixtures/test.pdf');

      const response = await testServer
        .post('/api/modules')
        .set('Authorization', `Bearer ${token}`)
        .field('title', 'Test Module Master')
        .field('description', 'Test Description')
        .field('excerpt', 'Test Excerpt')
        .field('preferredLanguage', 'en')
        .attach('pdf', pdfPath)
        .timeout(testTimeout);

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('success');
      expect(response.body.data.module).toBeDefined();
      expect(response.body.data.module.title).toBe('Test Module Master');
      expect(response.body.data.module.pdfUrl).toMatch(/^https?:\/\//);
    }, testTimeout);
  });

  describe('File validation', () => {
    it('should reject non-PDF files', async () => {
      const imagePath = path.join(__dirname, '../fixtures/test.jpg');
      fs.writeFileSync(imagePath, 'fake image content');

      try {
        const response = await testServer
          .post('/api/modules')
          .set('Authorization', `Bearer ${token}`)
          .field('title', 'Invalid File Test')
          .field('preferredLanguage', 'en')
          .attach('pdf', imagePath);

        expect(response.status).toBe(400);
      } finally {
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
      }
    });
  });

  afterAll(async () => {
    // Clean up test files
    const testFiles = [
      path.join(__dirname, '../fixtures/test.pdf'),
      path.join(__dirname, '../fixtures/test.jpg')
    ];

    for (const file of testFiles) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    }
  });
});