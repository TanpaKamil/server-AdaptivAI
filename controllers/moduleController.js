// src/controllers/moduleController.js
const moduleService = require('../services/moduleService');
const { uploadToCloudinary } = require('../config/cloudinary');
const { cleanupFile } = require('../utils/fileUtils');
const { AppError } = require('../middlewares/errorHandler');
const { ModuleMaster, ModuleInstance } = require('../models/ModuleMaster');

const moduleController = {
  // Create new module from PDF
  async createModule(req, res) {
    const { title, description, preferredLanguage = 'id' } = req.body;

    if (!req.file) {
      throw new AppError('Please upload a PDF file', 400);
    }

    try {
      // Upload to Cloudinary
      const cloudinaryResult = await uploadToCloudinary(req.file.path);

      // Create module with uploaded file
      const module = await moduleService.createModule(
        req.file.path,
        'tempUserId', // Temporary until auth is implemented
        title,
        description,
        preferredLanguage
      );

      // Cleanup local file
      await cleanupFile(req.file.path);

      res.status(201).json({
        status: 'success',
        data: {
          module,
          pdfUrl: cloudinaryResult.secure_url
        }
      });
    } catch (error) {
      // Ensure cleanup even if error occurs
      await cleanupFile(req.file.path);
      throw error;
    }
  },

  // Get all modules
  async getAllModules(req, res) {
    const modules = await ModuleMaster.find()
      .select('title description excerpt chapters.title isRecommended')
      .sort('-createdAt');

    res.status(200).json({
      status: 'success',
      data: {
        modules
      }
    });
  },

  // Get specific module
  async getModuleById(req, res) {
    const module = await ModuleMaster.findById(req.params.moduleId);

    if (!module) {
      throw new AppError('Module not found', 404);
    }

    res.status(200).json({
      status: 'success',
      data: {
        module
      }
    });
  },

  // Generate content for a chapter
  async generateChapterContent(req, res) {
    const { moduleId, chapterId } = req.params;
    const { preferredLanguage = 'id' } = req.body;

    const chapter = await moduleService.generateChapterContent(
      moduleId,
      chapterId,
      preferredLanguage
    );

    res.status(200).json({
      status: 'success',
      data: {
        chapter
      }
    });
  },

  // Get chapter content
  async getChapterContent(req, res) {
    const { moduleId, chapterId } = req.params;

    const module = await ModuleMaster.findById(moduleId);
    if (!module) {
      throw new AppError('Module not found', 404);
    }

    const chapter = module.chapters.id(chapterId);
    if (!chapter) {
      throw new AppError('Chapter not found', 404);
    }

    res.status(200).json({
      status: 'success',
      data: {
        chapter
      }
    });
  },

  // Start a new module instance
  async startModuleInstance(req, res) {
    const { moduleId } = req.params;

    const instance = await ModuleInstance.create({
      moduleMasterId: moduleId,
      userId: 'tempUserId', // Temporary until auth is implemented
      currentState: {
        currentChapterIndex: 0,
        currentLevelIndex: 0,
        comprehensionScore: 0,
        lastAssessmentLevel: 1
      }
    });

    res.status(201).json({
      status: 'success',
      data: {
        instance
      }
    });
  },

  // Get instance progress
  async getInstanceProgress(req, res) {
    const instance = await ModuleInstance.findById(req.params.instanceId)
      .populate('moduleMasterId');

    if (!instance) {
      throw new AppError('Module instance not found', 404);
    }

    res.status(200).json({
      status: 'success',
      data: {
        instance
      }
    });
  },

  // Submit assessment answers
  async submitAssessment(req, res) {
    const { instanceId } = req.params;
    const { answers, preferredLanguage = 'id' } = req.body;

    const result = await moduleService.evaluateAndAdapt(
      instanceId,
      answers,
      preferredLanguage
    );

    res.status(200).json({
      status: 'success',
      data: result
    });
  },

  // Get next set of questions
  async getNextQuestions(req, res) {
    const instance = await ModuleInstance.findById(req.params.instanceId)
      .populate('moduleMasterId');

    if (!instance) {
      throw new AppError('Module instance not found', 404);
    }

    const currentChapter = instance.moduleMasterId.chapters[instance.currentState.currentChapterIndex];
    const currentLevel = currentChapter.levels.find(
      l => l.bloomLevel === instance.currentState.lastAssessmentLevel
    );

    // Get questions that haven't been attempted yet
    const attemptedQuestionIds = instance.progress.currentQuestions.map(q => q.questionId.toString());
    const availableQuestions = currentLevel.questions.filter(
      q => !attemptedQuestionIds.includes(q._id.toString())
    );

    // Select next batch of questions (e.g., 5 questions)
    const nextQuestions = availableQuestions.slice(0, 5);

    res.status(200).json({
      status: 'success',
      data: {
        questions: nextQuestions,
        currentLevel: instance.currentState.lastAssessmentLevel,
        progress: {
          completedQuestions: attemptedQuestionIds.length,
          totalQuestions: currentLevel.questions.length
        }
      }
    });
  }
};

module.exports = moduleController;