// src/controllers/moduleController.js
const moduleService = require('../services/moduleService');
const { uploadToCloudinary } = require('../config/cloudinary');
const { cleanupFile } = require('../utils/fileUtils');
const { AppError } = require('../middlewares/errorHandler');
const { ModuleMaster } = require('../models/ModuleMaster');
const { ModuleInstance } = require('../models/ModuleInstance');
const mongoose = require('mongoose');

class ModuleController {
  // Create a new module
  async createModule(req, res) {
    const { title, description, preferredLanguage = 'id' } = req.body;
    let cloudinaryResult = null;

    // Validate request
    if (!req.file) {
      throw new AppError('Please upload a PDF file', 400);
    }

    if (!req.file.mimetype || req.file.mimetype !== 'application/pdf') {
      await cleanupFile(req.file.path);
      throw new AppError('Invalid file type. Please upload a PDF file', 400);
    }

    try {
      // Upload to Cloudinary first
      try {
        cloudinaryResult = await uploadToCloudinary(req.file.path);
        if (!cloudinaryResult || !cloudinaryResult.secure_url) {
          throw new AppError('Failed to upload file to storage', 500);
        }
      } catch (cloudinaryError) {
        console.error('Cloudinary upload error:', cloudinaryError);
        throw new AppError('Failed to upload file: ' + cloudinaryError.message, 500);
      }

      // Create module
      const tempUserId = new mongoose.Types.ObjectId();
      const module = await moduleService.createModule(
        req.file.path,
        tempUserId,
        title,
        description,
        preferredLanguage,
        cloudinaryResult.secure_url
      );

      res.status(201).json({
        status: 'success',
        data: { module }
      });

    } catch (error) {
      // Cleanup local file
      await cleanupFile(req.file.path);

      // Cleanup Cloudinary if upload succeeded but module creation failed
      if (cloudinaryResult?.public_id) {
        try {
          await cloudinary.uploader.destroy(cloudinaryResult.public_id, { resource_type: 'raw' });
        } catch (cleanupError) {
          console.error('Failed to cleanup Cloudinary:', cleanupError);
        }
      }

      throw new AppError(
        `Module creation failed: ${error.message}`,
        error.statusCode || 500
      );
    }
  }

  // Get all modules with basic info
  async getAllModules(req, res) {
    const modules = await ModuleMaster.find()
      .select('title description excerpt chapters.title metadata.difficultyLevel isRecommended')
      .sort('-createdAt');

    res.status(200).json({
      status: 'success',
      data: { modules }
    });
  }

  // Get specific module with full details
  async getModuleById(req, res) {
    const module = await ModuleMaster.findById(req.params.moduleId);

    if (!module) {
      throw new AppError('Module not found', 404);
    }

    res.status(200).json({
      status: 'success',
      data: { module }
    });
  }

  // Generate content for a chapter
  async generateChapterContent(req, res) {
    const { moduleId, chapterId } = req.params;
    const { preferredLanguage = 'id' } = req.body;
    const tempUserId = new mongoose.Types.ObjectId();

    const chapter = await moduleService.generateChapterContent(
      moduleId,
      chapterId,
      tempUserId,
      preferredLanguage
    );

    res.status(200).json({
      status: 'success',
      data: { chapter }
    });
  }

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
      data: { chapter }
    });
  }

  // Start a new module instance
  async startModuleInstance(req, res) {
    const tempUserId = new mongoose.Types.ObjectId();
    const { moduleId } = req.params;

    // Use service method to create instance with initial question set
    const instance = await moduleService.startModuleInstance(moduleId, tempUserId);

    res.status(201).json({
      status: 'success',
      data: { instance }
    });
  }

  // Get instance progress
  async getInstanceProgress(req, res) {
    const instance = await ModuleInstance.findById(req.params.instanceId)
      .populate({
        path: 'moduleMasterId',
        select: 'title chapters.title chapters.order'
      });

    if (!instance) {
      throw new AppError('Module instance not found', 404);
    }

    // Get current chapter progress
    const currentChapterProgress = instance.chapterProgress[instance.currentState.currentChapterIndex];

    // Get current question set details
    const currentSetProgress = currentChapterProgress.questionSets.find(
      qs => qs.setId.equals(instance.currentState.currentQuestionSetId)
    );

    res.status(200).json({
      status: 'success',
      data: {
        instance: {
          id: instance._id,
          moduleTitle: instance.moduleMasterId.title,
          currentChapter: {
            index: instance.currentState.currentChapterIndex,
            title: instance.moduleMasterId.chapters[instance.currentState.currentChapterIndex]?.title
          },
          progress: {
            overall: instance.currentState.comprehensionScore,
            currentLevel: instance.currentState.lastAssessmentLevel,
            currentSet: {
              setNumber: currentSetProgress?.setNumber,
              type: currentSetProgress?.type,
              progress: {
                completed: currentSetProgress?.questions.filter(q => q.status === 'completed').length || 0,
                total: currentSetProgress?.questions.length || 0
              }
            },
            masteredLevels: currentChapterProgress.masteredLevels
          },
          adaptiveHistory: instance.adaptiveHistory
        }
      }
    });
  }

  // Get next set of questions
  async getNextQuestions(req, res) {
    const result = await moduleService.getNextQuestions(req.params.instanceId);

    res.status(200).json({
      status: 'success',
      data: result
    });
  }

  async submitAssessment(req, res) {
    const { instanceId } = req.params;
    const { answers, preferredLanguage = 'id' } = req.body;

    try {
      // Validate answers structure
      if (!Array.isArray(answers) || !answers.length) {
        throw new AppError('Invalid answers format', 400);
      }

      // Validate each answer
      const validAnswers = answers.every(answer => {
        if (!answer.questionId || typeof answer.selectedOption !== 'number') {
          return false;
        }
        // Ensure questionId is a valid ObjectId
        try {
          return mongoose.Types.ObjectId.isValid(answer.questionId);
        } catch (error) {
          return false;
        }
      });

      if (!validAnswers) {
        throw new AppError('Invalid answer format. Each answer must have questionId (valid ObjectId) and selectedOption (number)', 400);
      }

      // Process answers with validated ObjectIds
      const processedAnswers = answers.map(answer => ({
        questionId: answer.questionId,
        selectedOption: answer.selectedOption
      }));

      const result = await moduleService.evaluateAndAdapt(
        instanceId,
        processedAnswers,
        preferredLanguage
      );

      res.status(200).json({
        status: 'success',
        data: {
          evaluation: {
            score: result.evaluation.score,
            recommendedLevel: result.evaluation.recommendedLevel,
            needsAdaptation: result.evaluation.needsAdaptation,
            strengths: result.evaluation.strengths,
            weakAreas: result.evaluation.weakAreas
          },
          adaptiveContent: result.adaptiveContent ? {
            setId: result.adaptiveContent.questionSetId,
            type: result.adaptiveContent.type,
            questions: result.adaptiveContent.questions,
            flashcardIds: result.adaptiveContent.flashcardIds
          } : null
        }
      });
    } catch (error) {
      console.error('Error in submitAssessment:', error);
      throw new AppError(error.message || 'Error submitting assessment', 500);
    }
  }
}

module.exports = ModuleController;