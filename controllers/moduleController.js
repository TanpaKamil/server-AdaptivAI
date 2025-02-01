// src/controllers/moduleController.js
const moduleService = require('../services/moduleService');
const { uploadToCloudinary } = require('../config/cloudinary');
const { cleanupFile } = require('../utils/fileUtils');
const { AppError } = require('../middlewares/errorHandler');
const { ModuleMaster } = require('../models/ModuleMaster');
const { ModuleInstance } = require('../models/ModuleInstance');
const mongoose = require('mongoose');
const fs = require('fs').promises;

const moduleController = {

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
      const tempUserId = new mongoose.Types.ObjectId();

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

      // Create module with the cloudinary URL
      const module = await moduleService.createModule(
        req.file.path,
        tempUserId,
        title,
        description,
        preferredLanguage,
        cloudinaryResult.secure_url
      );

      // Cleanup local file
      await cleanupFile(req.file.path);

      // Return response with module data only
      res.status(201).json({
        status: 'success',
        data: {
          module
        }
      });

    } catch (error) {
      // Cleanup local file
      await cleanupFile(req.file.path);

      // Cleanup Cloudinary if upload succeeded but module creation failed
      if (cloudinaryResult && cloudinaryResult.public_id) {
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

    // Ambil module dulu untuk mendapatkan userId dari metadata.caches
    const module = await ModuleMaster.findById(moduleId);
    if (!module) {
      throw new AppError('Module not found', 404);
    }

    // Ambil cache terbaru
    const latestCache = module.metadata?.caches?.sort((a, b) =>
      new Date(b.expiresAt) - new Date(a.expiresAt)
    )[0];

    if (!latestCache) {
      throw new AppError('No valid cache found for this module', 400);
    }

    const chapter = await moduleService.generateChapterContent(
      moduleId,
      chapterId,
      latestCache.userId, // Gunakan userId dari cache
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

  async startModuleInstance(req, res) {
    const tempUserId = new mongoose.Types.ObjectId();
    const { moduleId } = req.params;

    const module = await ModuleMaster.findById(moduleId);
    if (!module) {
      throw new AppError('Module not found', 404);
    }

    // Get initial chapter
    const initialChapter = module.chapters[0];
    if (!initialChapter) {
      throw new AppError('Chapter not found', 404);
    }

    // Collect questions from all levels for initial assessment
    const initialQuestions = initialChapter.levels.reduce((acc, level) => {
      return [...acc, ...level.questions.map(q => ({
        questionId: q._id,
        status: 'active',
        bloomLevel: level.bloomLevel
      }))];
    }, []);

    const instance = await ModuleInstance.create({
      moduleMasterId: moduleId,
      userId: tempUserId,
      currentState: {
        currentChapterIndex: 0,
        currentLevelIndex: 0,
        comprehensionScore: 0,
        lastAssessmentLevel: 1
      },
      currentQuestionSet: {
        questions: initialQuestions,
        setStatus: 'in_progress',
        isInitialAssessment: true // Flag untuk menandai ini assessment awal
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

  async getNextQuestions(req, res) {
    try {
      const instance = await ModuleInstance.findById(req.params.instanceId)
        .populate({
          path: 'moduleMasterId',
          populate: {
            path: 'chapters'
          }
        });

      console.log("Current Chapter:", instance.moduleMasterId.chapters[0].title);
      console.log("Current Chapter Levels:", instance.moduleMasterId.chapters[0].levels);
      console.log("Question Set:", instance.currentQuestionSet);

      // Get active questions directly from ModuleMaster
      const currentChapter = instance.moduleMasterId.chapters[instance.currentState.currentChapterIndex];
      const currentSet = instance.currentQuestionSet;

      // Flatten all questions from all levels
      const allQuestions = currentChapter.levels.reduce((acc, level) => {
        return [...acc, ...level.questions.map(q => ({
          ...q.toObject(),
          bloomLevel: level.bloomLevel
        }))];
      }, []);

      // Map active questions from currentSet to full questions
      const activeQuestions = currentSet.questions
        .filter(q => q.status === 'active')
        .map(activeQ => {
          const fullQuestion = allQuestions.find(q =>
            q._id.toString() === activeQ.questionId.toString()
          );

          if (fullQuestion) {
            return {
              questionId: activeQ.questionId,
              question: fullQuestion.question,
              options: fullQuestion.options,
              bloomLevel: fullQuestion.bloomLevel
            };
          }
          return null;
        })
        .filter(q => q !== null);

      res.status(200).json({
        status: 'success',
        data: {
          questions: activeQuestions,
          isInitialAssessment: currentSet.isInitialAssessment,
          progress: {
            answered: currentSet.questions.filter(q => q.status === 'answered').length,
            total: currentSet.questions.length,
            remaining: currentSet.questions.filter(q => q.status === 'active').length
          }
        }
      });
    } catch (error) {
      console.error('Error in getNextQuestions:', error);
      throw error;
    }
  },

  async submitAssessment(req, res) {
    const { instanceId } = req.params;
    const { answers, preferredLanguage } = req.body;

    try {
      // Gunakan findOneAndUpdate untuk atomic operation
      const instance = await ModuleInstance.findOneAndUpdate(
        { _id: instanceId },
        {
          $set: {
            'currentQuestionSet.questions.$[elem].status': 'answered',
            'currentQuestionSet.setStatus': 'completed'
          }
        },
        {
          arrayFilters: [
            {
              'elem.questionId': {
                $in: answers.map(a => new mongoose.Types.ObjectId(a.questionId))
              }
            }
          ],
          new: true,
          runValidators: true
        }
      ).populate('moduleMasterId');

      if (!instance) {
        throw new AppError('Module instance not found', 404);
      }

      // Evaluate understanding and adapt
      const result = await moduleService.evaluateAndAdapt(
        instanceId,
        answers,
        preferredLanguage
      );

      res.status(200).json({
        status: 'success',
        data: result
      });
    } catch (error) {
      console.error('Error in submitAssessment:', error);
      throw new AppError(error.message || 'Error submitting assessment', 500);
    }
  }
};

module.exports = moduleController;