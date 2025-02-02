// src/controllers/moduleController.js
const moduleService = require('../services/moduleService');
const { uploadToCloudinary } = require('../config/cloudinary');
const { cleanupFile } = require('../utils/fileUtils');
const { AppError } = require('../middlewares/errorHandler');
const { ModuleMaster } = require('../models/ModuleMaster');
const { ModuleInstance } = require('../models/ModuleInstance');
const mongoose = require('mongoose');
const fs = require('fs').promises;

class ModuleController {

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
  };

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
  };

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
  };

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
  };

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
  };

  async startModuleInstance(req, res) {
    const tempUserId = new mongoose.Types.ObjectId();
    const { moduleId } = req.params;

    // Get module master
    const module = await ModuleMaster.findById(moduleId);
    if (!module) {
      throw new AppError('Module not found', 404);
    }

    // Get initial chapter
    const initialChapter = module.chapters[0];
    if (!initialChapter) {
      throw new AppError('Chapter not found', 404);
    }

    // Initialize initial questions with metadata
    const initialQuestions = [];

    // Get 2 questions each from levels 1-4
    for (let level = 1; level <= 4; level++) {
      const levelQuestions = initialChapter.levels
        .find(l => l.bloomLevel === level)?.questions || [];

      const selected = levelQuestions
        .slice(0, 2)
        .map(q => ({
          questionId: q._id,
          status: 'pending',
          bloomLevel: level,
          attemptNumber: 1
        }));

      initialQuestions.push(...selected);
    }

    // Get 1 question each from levels 5-6
    for (let level = 5; level <= 6; level++) {
      const levelQuestions = initialChapter.levels
        .find(l => l.bloomLevel === level)?.questions || [];

      const selected = levelQuestions
        .slice(0, 1)
        .map(q => ({
          questionId: q._id,
          status: 'pending',
          bloomLevel: level,
          attemptNumber: 1
        }));

      initialQuestions.push(...selected);
    }

    // Create new instance with initial questions
    const instance = await ModuleInstance.create({
      moduleMasterId: moduleId,
      userId: tempUserId,
      currentState: {
        currentChapterIndex: 0,
        currentLevelIndex: 0,
        comprehensionScore: 0,
        lastAssessmentLevel: 1
      },
      progress: {
        completedChapters: [],
        masteredLevels: [],
        currentQuestions: initialQuestions.map(q => ({
          ...q,
          _id: new mongoose.Types.ObjectId(),
          setStatus: 'in_progress'
        }))
      },
      status: 'in_progress',
      startedAt: new Date(),
      lastAccessedAt: new Date()
    });

    res.status(201).json({
      status: 'success',
      data: {
        instance
      }
    });
  };

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
  };

  async getNextQuestions(req, res) {
    try {
      // 1. Get instance with populated master
      const instance = await ModuleInstance.findById(req.params.instanceId)
        .populate({
          path: 'moduleMasterId',
          populate: {
            path: 'chapters'
          }
        });

      if (!instance) {
        throw new AppError('Module instance not found', 404);
      }

      // 2. Get current chapter
      const currentChapter = instance.moduleMasterId.chapters[instance.currentState.currentChapterIndex];

      // 3. Get pending questions from instance
      const currentQuestions = instance.progress.currentQuestions;
      const pendingQuestions = currentQuestions.filter(q => q.status === 'pending');

      // 4. Create a map of all questions from master for efficient lookup
      const questionMap = {};
      currentChapter.levels.forEach(level => {
        level.questions.forEach(question => {
          questionMap[question._id.toString()] = {
            ...question.toObject(),
            bloomLevel: level.bloomLevel
          };
        });
      });

      // 5. Map pending questions to their full details from master
      const questionsWithDetails = pendingQuestions.map(pendingQ => {
        const masterQuestion = questionMap[pendingQ.questionId.toString()];

        if (!masterQuestion) {
          console.error(`Question not found in master: ${pendingQ.questionId}`);
          return null;
        }

        return {
          _id: pendingQ._id,
          questionId: pendingQ.questionId,
          question: masterQuestion.question,
          options: masterQuestion.options,
          bloomLevel: pendingQ.bloomLevel,
          attemptNumber: pendingQ.attemptNumber,
          setStatus: pendingQ.setStatus
        };
      }).filter(q => q !== null);

      // 6. Send response
      res.status(200).json({
        status: 'success',
        data: {
          questions: questionsWithDetails,
          progress: {
            answered: currentQuestions.filter(q => q.status === 'completed').length,
            total: currentQuestions.length,
            remaining: pendingQuestions.length
          }
        }
      });
    } catch (error) {
      console.error('Error in getNextQuestions:', error);
      throw error;
    }
  }

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

module.exports = ModuleController;