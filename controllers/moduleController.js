const moduleService = require('../services/moduleService');
const { uploadToCloudinary, cloudinary } = require('../config/cloudinary');
const { cleanupFile } = require('../utils/fileUtils');
const { AppError } = require('../middlewares/errorHandler');
const { ModuleMaster } = require('../models/ModuleMaster');
const { ModuleInstance } = require('../models/ModuleInstance');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');

class ModuleController {

  async verifyInstanceOwnership(instance, userId) {
    if (!instance) {
      throw new AppError('Module instance not found', 404);
    }
    if (instance.userId.toString() !== userId) {
      throw new AppError('You don\'t have permission to access this instance', 403);
    }
  }

  async verifyModuleOwnership(module, userId) {
    if (!module) {
      throw new AppError('Module not found', 404);
    }
    if (module.createdBy.toString() !== userId) {
      throw new AppError('You don\'t have permission to modify this module', 403);
    }
  }

  // Create a new module
  async createModule(req, res) {
    const { title, description, preferredLanguage = 'id' } = req.body;
    let cloudinaryResult = null;
    let localFilePath = null;

    // Validate request
    if (!req.file) {
      throw new AppError('Please upload a PDF file', 400);
    }

    localFilePath = path.resolve(req.file.path); // Get absolute path

    // Verify file exists before proceeding
    try {
      const stats = await fs.stat(localFilePath);
      if (stats.size === 0) {
        throw new AppError('Uploaded file is empty', 400);
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new AppError('Upload failed: File not found. Please try again.', 400);
      }
      throw error;
    }

    if (!req.file.mimetype || req.file.mimetype !== 'application/pdf') {
      await cleanupFile(localFilePath);
      throw new AppError('Invalid file type. Please upload a PDF file', 400);
    }

    try {
      // Upload to Cloudinary first
      try {
        cloudinaryResult = await uploadToCloudinary(localFilePath);
        if (!cloudinaryResult || !cloudinaryResult.secure_url) {
          throw new AppError('Failed to upload file to storage', 500);
        }
      } catch (cloudinaryError) {
        console.error('Cloudinary upload error:', cloudinaryError);
        throw new AppError('Failed to upload file: ' + cloudinaryError.message, 500);
      }

      // Create module with auto-generated content
      const userId = req.user.id;
      const module = await moduleService.createModuleWithContent(
        localFilePath,
        userId,
        title,
        description,
        preferredLanguage,
        cloudinaryResult.secure_url
      );

      // Only clean up the local file after everything is done
      await cleanupFile(localFilePath);

      res.status(201).json({
        status: 'success',
        data: { module }
      });

    } catch (error) {
      // If anything fails, clean up both local file and Cloudinary
      try {
        if (localFilePath) {
          await cleanupFile(localFilePath);
        }

        if (cloudinaryResult?.public_id) {
          await cloudinary.uploader.destroy(cloudinaryResult.public_id, { resource_type: 'raw' });
        }
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
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
      .lean()  // Convert to plain JavaScript objects
      .sort('-createdAt');

    res.status(200).json({
      status: 'success',
      data: { modules }
    });
  }

  // Get specific module with full details
  async getModuleById(req, res) {
    const module = await ModuleMaster.findById(req.params.moduleId);

    await this.verifyModuleOwnership(module, req.user.id);

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
    const userId = req.user.id;

    const module = await ModuleMaster.findById(moduleId);

    await this.verifyModuleOwnership(module, req.user.id);


    const chapter = await moduleService.generateChapterContent(
      moduleId,
      chapterId,
      userId,
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

    await this.verifyModuleOwnership(module, req.user.id);

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
    const userId = req.user.id;
    const { moduleId } = req.params;

    // Use service method to create instance with initial question set
    const instance = await moduleService.startModuleInstance(moduleId, userId);

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

    await this.verifyInstanceOwnership(instance, req.user.id)

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
    const { preferredLanguage = 'id' } = req.body;

    try {
      // Get the instance and current question set
      const instance = await ModuleInstance.findOne({
        _id: instanceId,
        userId: req.user.id
      });

      await this.verifyInstanceOwnership(instance, req.user.id)

      if (!instance) {
        throw new AppError('Module instance not found', 404);
      }

      // Get current chapter progress
      const currentChapterProgress = instance.chapterProgress[instance.currentState.currentChapterIndex];
      if (!currentChapterProgress) {
        throw new AppError('Chapter progress not found', 404);
      }

      // Find current question set
      const currentQuestionSet = currentChapterProgress.questionSets.find(
        qs => qs.setId.equals(instance.currentState.currentQuestionSetId)
      );

      if (!currentQuestionSet) {
        throw new AppError('Current question set not found', 404);
      }

      // Collect all completed answers from the question set
      const answers = currentQuestionSet.questions
        .filter(q => q.status === 'completed' && typeof q.userAnswer === 'number')
        .map(q => ({
          questionId: q.questionId,
          selectedOption: q.userAnswer
        }));

      // Validate we have answers to evaluate
      if (!answers.length) {
        throw new AppError('No completed answers found in current question set', 400);
      }

      // Process evaluation with collected answers
      const result = await moduleService.evaluateAndAdapt(
        instanceId,
        answers,
        preferredLanguage
      );

      if (result.evaluation.moduleCompleted) {
        res.status(200).json({
          status: 'success',
          data: {
            moduleCompleted: true,
            evaluation: {
              finalScore: result.evaluation.finalScore,
              completionDate: result.evaluation.completionDate,
              summary: result.evaluation.summary
            }
          }
        });
      } else {
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
      }

    } catch (error) {
      console.error('Error in submitAssessment:', error);
      throw new AppError(error.message || 'Error submitting assessment', 500);
    }
  }

  // Get featured public modules
  async getFeaturedPublicModules(req, res) {
    try {
      const featuredModules = await ModuleMaster.find({ isActive: true })
        .limit(5)
        .select('title description excerpt createdBy subscribedUsers metadata')
        .populate('createdBy', 'username')
        .sort({ 'subscribedUsers': -1, 'createdAt': -1 }); // Sort by subscriber count and then date

      // Transform the response to include subscriber count
      const transformedModules = featuredModules.map(module => ({
        _id: module._id,
        title: module.title,
        description: module.description,
        excerpt: module.excerpt,
        createdBy: module.createdBy,
        totalSubscribers: module.subscribedUsers?.length || 0,
        metadata: module.metadata
      }));

      res.status(200).json({
        status: 'success',
        data: { modules: transformedModules }
      });
    } catch (error) {
      throw new AppError('Failed to retrieve featured public modules', 500);
    }
  }

  async getRecommendedPublicModules(req, res) {
    try {
      const recommendedModules = await ModuleMaster.find({
        isFeatured: true,
        isActive: true
      })
        .limit(3)
        .select('title description excerpt createdBy subscribedUsers metadata')
        .populate('createdBy', 'username')
        .sort('-createdAt');

      const transformedModules = recommendedModules.map(module => ({
        _id: module._id,
        title: module.title,
        description: module.description,
        excerpt: module.excerpt,
        createdBy: module.createdBy,
        totalSubscribers: module.subscribedUsers?.length || 0,
        metadata: module.metadata,
        isRecommended: true
      }));

      res.status(200).json({
        status: 'success',
        data: { modules: transformedModules }
      });
    } catch (error) {
      throw new AppError('Failed to retrieve recommended public modules', 500);
    }
  }

  async getAllPublicModules(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const search = req.query.search || '';

      const searchQuery = {
        isActive: true,
        ...(search ? {
          $or: [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
          ]
        } : {})
      };

      // Get total count for pagination
      const totalModules = await ModuleMaster.countDocuments(searchQuery);

      const modules = await ModuleMaster.find(searchQuery)
        .select('title description excerpt createdBy subscribedUsers createdAt metadata')
        .populate('createdBy', 'username')
        .sort('-createdAt')
        .skip((page - 1) * limit)
        .limit(limit);

      const transformedModules = modules.map(module => ({
        _id: module._id,
        title: module.title,
        description: module.description,
        excerpt: module.excerpt,
        createdBy: module.createdBy,
        totalSubscribers: module.subscribedUsers?.length || 0,
        createdAt: module.createdAt,
        metadata: module.metadata
      }));

      res.status(200).json({
        status: 'success',
        data: {
          modules: transformedModules,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(totalModules / limit),
            totalItems: totalModules
          }
        }
      });
    } catch (error) {
      throw new AppError('Failed to retrieve public modules', 500);
    }
  }

  async getPublicModuleById(req, res) {
    const { moduleId } = req.params;

    try {
      const module = await ModuleMaster.findById(moduleId)
        .select('-questionSets')
        .populate('createdBy', 'username');

      if (!module) {
        throw new AppError('Public module not found', 404);
      }

      const transformedModule = {
        _id: module._id,
        title: module.title,
        description: module.description,
        excerpt: module.excerpt,
        createdAt: module.createdAt,
        updatedAt: module.updatedAt,
        createdBy: module.createdBy,
        chapters: module.chapters.map(chapter => ({
          _id: chapter._id,
          title: chapter.title,
          order: chapter.order,
          excerpt: chapter.excerpt
        })),
        metadata: module.metadata,
        subscribedUsers: module.subscribedUsers?.length || 0,
        isRecommended: module.isRecommended
      };

      res.status(200).json({
        status: 'success',
        data: { module: transformedModule }
      });
    } catch (error) {
      throw new AppError('Failed to retrieve public module', 500);
    }
  }

  // Add public module to user's collection
  async addModuleToCollection(req, res) {
    const { moduleId } = req.params;
    const userId = req.user.id; // Assuming you have middleware to set req.user

    try {
      const module = await ModuleMaster.findById(moduleId);
      if (!module) {
        throw new AppError('Module not found', 404);
      }

      // Check if module is already in the user's collection
      const existingInstance = await ModuleInstance.findOne({
        moduleMasterId: moduleId,
        userId: userId
      });

      if (existingInstance) {
        return res.status(200).json({
          status: 'success',
          message: 'Module already in your collection'
        });
      }

      // Create a new module instance for the user
      const newInstance = await ModuleInstance.create({
        moduleMasterId: moduleId,
        userId: userId,
        currentState: {
          currentChapterIndex: 0,
          currentLevelIndex: 0,
          comprehensionScore: 0,
          lastAssessmentLevel: 1
        },
        chapterProgress: module.chapters.map((chapter, index) => ({
          chapterIndex: index,
          status: 'not_started',
          questionSets: []
        }))
      });

      res.status(201).json({
        status: 'success',
        data: { instance: newInstance }
      });

    } catch (error) {
      throw new AppError('Failed to add module to collection', 500);
    }
  }

  async getModuleInstance(req, res) {
    const { instanceId } = req.params;

    try {
      // Find instance and populate necessary fields
      const instance = await ModuleInstance.findOne({
        _id: instanceId,
        userId: req.user.id
      })
        .populate({
          path: 'moduleMasterId',
          select: 'title chapters excerpt'
        })
        .lean();

      if (!instance) {
        throw new AppError('Module instance not found', 404);
      }

      // Transform data to match required response format
      const response = {
        ModuleInstance: {
          _id: instance._id,
          moduleMasterId: instance.moduleMasterId._id,
          title: instance.moduleMasterId.title,
          progress: {
            completedChapters: instance.chapterProgress
              .filter(chapter => chapter.status === 'completed')
              .map(chapter => chapter._id)
          },
          chapters: instance.moduleMasterId.chapters.map(chapter => ({
            _id: chapter._id,
            title: chapter.title,
            order: chapter.order
          })),
          excerpt: instance.moduleMasterId.excerpt,
          createdDate: instance.createdAt,
          status: instance.status,
          lastAccessedAt: instance.lastAccessedAt,
          currentState: {
            currentChapterIndex: instance.currentState.currentChapterIndex,
            currentLevelIndex: instance.currentState.currentLevelIndex,
            comprehensionScore: instance.currentState.comprehensionScore,
            lastAssessmentLevel: instance.currentState.lastAssessmentLevel
          }
        }
      };

      res.status(200).json(response);
    } catch (error) {
      throw new AppError(error.message, error.statusCode || 500);
    }
  }

  async getChapter(req, res) {
    const { instanceId, chapterId } = req.params;

    try {
      // Find instance and populate necessary module master data
      const instance = await ModuleInstance.findOne({
        _id: instanceId,
        userId: req.user.id
      })
        .populate({
          path: 'moduleMasterId',
          populate: {
            path: 'chapters',
            match: { _id: chapterId }
          }
        })
        .lean();


      await this.verifyInstanceOwnership(instance, req.user.id)
      if (!instance) {
        throw new AppError('Module instance not found', 404);
      }

      if (!instance.moduleMasterId || !instance.moduleMasterId.chapters || instance.moduleMasterId.chapters.length === 0) {
        throw new AppError('Chapter not found', 404);
      }

      // Get chapter data
      const chapter = instance.moduleMasterId.chapters[0]; // Since we filtered by ID, there's only one

      // Get chapter progress from instance
      const chapterProgress = instance.chapterProgress.find(
        cp => cp.chapterIndex === instance.currentState.currentChapterIndex
      );

      // Prepare response
      const response = {
        chapter: {
          _id: chapter._id,
          title: chapter.title,
          order: chapter.order,
          content: {
            summaries: chapter.summaries.map(summary => ({
              _id: summary._id,
              content: summary.content,
              comprehensionLevel: summary.comprehensionLevel,
              flashcardFront: summary.flashcardFront,
              flashcardBack: summary.flashcardBack,
              relatedConcepts: summary.relatedConcepts || [],
              practicePrompt: summary.practicePrompt || ''
            })),
            levels: chapter.levels.map(level => ({
              _id: level._id,
              bloomLevel: level.bloomLevel,
              questions: level.questions.map(q => ({
                _id: q._id,
                question: q.question,
                options: q.options,
                explanation: q.explanation,
                bloomLevel: q.bloomLevel,
                difficultyLevel: q.difficultyLevel,
                learningObjective: q.learningObjective,
                targetedConcept: q.targetedConcept
              }))
            }))
          },
          progress: chapterProgress ? {
            status: chapterProgress.status,
            masteredLevels: chapterProgress.masteredLevels || [],
            comprehensionScore: chapterProgress.comprehensionScore || 0,
            currentQuestionSetId: instance.currentState.currentQuestionSetId
          } : null
        },
        instanceState: {
          currentChapterIndex: instance.currentState.currentChapterIndex,
          currentLevelIndex: instance.currentState.currentLevelIndex,
          lastAssessmentLevel: instance.currentState.lastAssessmentLevel,
          comprehensionScore: instance.currentState.comprehensionScore
        }
      };

      res.status(200).json({
        status: 'success',
        data: response
      });

    } catch (error) {
      throw new AppError(error.message, error.statusCode || 500);
    }
  }

  async getAssessment(req, res) {
    const { instanceId } = req.params;

    try {
      const instance = await ModuleInstance.findOne({
        _id: instanceId,
        userId: req.user.id
      })
        .populate({
          path: 'moduleMasterId',
          populate: {
            path: 'chapters',
            populate: {
              path: 'questionSets'
            }
          }
        });

      await this.verifyInstanceOwnership(instance, req.user.id)

      if (!instance) {
        throw new AppError('Module instance not found', 404);
      }

      // Get current chapter and question set
      const currentChapter = instance.moduleMasterId.chapters[instance.currentState.currentChapterIndex];
      const currentQuestionSet = currentChapter.questionSets.find(
        qs => qs._id.toString() === instance.currentState.currentQuestionSetId.toString()
      );

      if (!currentQuestionSet) {
        throw new AppError('Current question set not found', 404);
      }

      // Get current progress
      const currentProgress = instance.chapterProgress[instance.currentState.currentChapterIndex]
        .questionSets.find(qs => qs.setId.toString() === currentQuestionSet._id.toString());

      // Map questions with their details
      const questions = currentQuestionSet.questionRefs.map(ref => {
        const progress = currentProgress.questions.find(
          q => q.questionId.toString() === ref.questionId.toString()
        );

        return {
          questionId: ref.questionId,
          question: ref.question,
          options: ref.options,
          correctAnswer: ref.correctAnswer,
          explanation: ref.explanation,
          status: progress?.status || 'pending',
          userAnswer: progress?.userAnswer,
          isCorrect: progress?.isCorrect,
          answeredAt: progress?.answeredAt
        };
      });

      res.status(200).json({
        currentQuestions: questions
      });
    } catch (error) {
      throw new AppError(error.message, error.statusCode || 500);
    }
  }

  async submitAnswer(req, res) {
    const { instanceId } = req.params;
    const { questionId, userAnswer } = req.body;

    try {
      const instance = await ModuleInstance.findOne({
        _id: instanceId,
        userId: req.user.id
      })
        .populate({
          path: 'moduleMasterId',
          populate: {
            path: 'chapters',
            populate: {
              path: 'questionSets'
            }
          }
        });

      await this.verifyInstanceOwnership(instance, req.user.id)
      if (!instance) {
        throw new AppError('Module instance not found', 404);
      }

      // Get current chapter and question
      const currentChapter = instance.moduleMasterId.chapters[instance.currentState.currentChapterIndex];
      const currentQuestionSet = currentChapter.questionSets.find(
        qs => qs._id.toString() === instance.currentState.currentQuestionSetId.toString()
      );

      const questionRef = currentQuestionSet.questionRefs.find(
        ref => ref.questionId.toString() === questionId
      );

      if (!questionRef) {
        throw new AppError('Question not found', 404);
      }

      // Check if answer is correct
      const isCorrect = questionRef.correctAnswer === userAnswer;

      // Update progress
      await ModuleInstance.updateOne(
        {
          _id: instanceId,
          'chapterProgress.chapterIndex': instance.currentState.currentChapterIndex,
          'chapterProgress.questionSets.setId': currentQuestionSet._id,
          'chapterProgress.questionSets.questions.questionId': questionId
        },
        {
          $set: {
            'chapterProgress.$[chapter].questionSets.$[qset].questions.$[question].status': 'completed',
            'chapterProgress.$[chapter].questionSets.$[qset].questions.$[question].userAnswer': userAnswer,
            'chapterProgress.$[chapter].questionSets.$[qset].questions.$[question].isCorrect': isCorrect,
            'chapterProgress.$[chapter].questionSets.$[qset].questions.$[question].answeredAt': new Date()
          }
        },
        {
          arrayFilters: [
            { 'chapter.chapterIndex': instance.currentState.currentChapterIndex },
            { 'qset.setId': currentQuestionSet._id },
            { 'question.questionId': questionId }
          ]
        }
      );

      res.status(200).json({
        message: isCorrect ? 'Benar' : 'Salah'
      });
    } catch (error) {
      throw new AppError(error.message, error.statusCode || 500);
    }
  }

  async getUserInstances(req, res) {
    try {
      // TODO: Replace with actual userId from auth token
      const dummyUserId = new mongoose.Types.ObjectId("65c7603b2935968d18e2c619");

      const instances = await ModuleInstance.find({ userId: dummyUserId })
        .populate({
          path: 'moduleMasterId',
          select: 'title description'  // Only select what we need from master
        })
        .select('status lastAccessedAt')  // Only select what we need from instance
        .sort('-lastAccessedAt')
        .lean();

      // Transform to simpler format for cards
      const formattedInstances = instances.map(instance => ({
        _id: instance._id,
        title: instance.moduleMasterId.title,
        description: instance.moduleMasterId.description,
        status: instance.status,
        lastAccessedAt: instance.lastAccessedAt
      }));

      res.status(200).json({
        status: 'success',
        data: {
          instances: formattedInstances
        }
      });
    } catch (error) {
      throw new AppError(error.message, error.statusCode || 500);
    }
  }

  // Add to ModuleController class

  async updateAssessmentAnswer(req, res) {
    const { instanceId } = req.params;
    const { questionId, userAnswer } = req.body;

    try {
      const instance = await ModuleInstance.findOne({
        _id: instanceId,
        userId: req.user.id
      });

      await this.verifyInstanceOwnership(instance, req.user.id)
      if (!instance) {
        throw new AppError('Module instance not found', 404);
      }

      // Get current chapter progress
      const currentChapterProgress = instance.chapterProgress[instance.currentState.currentChapterIndex];
      if (!currentChapterProgress) {
        throw new AppError('Chapter progress not found', 404);
      }

      // Find current question set
      const currentQuestionSet = currentChapterProgress.questionSets.find(
        qs => qs.setId.equals(instance.currentState.currentQuestionSetId)
      );

      if (!currentQuestionSet) {
        throw new AppError('Current question set not found', 404);
      }

      // Find question in the set
      const questionIndex = currentQuestionSet.questions.findIndex(
        q => q.questionId.equals(questionId)
      );

      if (questionIndex === -1) {
        throw new AppError('Question not found in current set', 404);
      }

      // Update the user's answer
      await ModuleInstance.updateOne(
        {
          _id: instanceId,
          'chapterProgress.chapterIndex': instance.currentState.currentChapterIndex,
          'chapterProgress.questionSets.setId': instance.currentState.currentQuestionSetId,
          'chapterProgress.questionSets.questions.questionId': questionId
        },
        {
          $set: {
            'chapterProgress.$[chapter].questionSets.$[qset].questions.$[question].userAnswer': userAnswer,
            'chapterProgress.$[chapter].questionSets.$[qset].questions.$[question].status': 'completed',
            'chapterProgress.$[chapter].questionSets.$[qset].questions.$[question].answeredAt': new Date()
          }
        },
        {
          arrayFilters: [
            { 'chapter.chapterIndex': instance.currentState.currentChapterIndex },
            { 'qset.setId': instance.currentState.currentQuestionSetId },
            { 'question.questionId': questionId }
          ]
        }
      );

      res.status(200).json({
        status: 'success',
        message: 'Answer updated successfully'
      });

    } catch (error) {
      throw new AppError(error.message, error.statusCode || 500);
    }
  }
  async getLevels(req, res) {
    const { instanceId, chapterId } = req.params;

    try {
      const instance = await ModuleInstance.findOne({
        _id: instanceId,
        userId: req.user.id
      })
        .populate({
          path: 'moduleMasterId',
          populate: {
            path: 'chapters',
            match: { _id: chapterId },
            select: 'levels'
          }
        });

      await this.verifyInstanceOwnership(instance, req.user.id)
      if (!instance) {
        throw new AppError('Module instance not found', 404);
      }

      if (!instance.moduleMasterId?.chapters?.length) {
        throw new AppError('Chapter not found', 404);
      }

      const chapter = instance.moduleMasterId.chapters[0];

      // Format levels according to response specification
      const formattedLevels = chapter.levels.map(level => ({
        _id: level._id,
        bloomLevel: level.bloomLevel,
        questions: level.questions.map(q => ({
          _id: q._id,
          question: q.question,
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          bloomLevel: q.bloomLevel
        }))
      }));

      res.status(200).json({
        status: 'success',
        data: {
          levels: formattedLevels
        }
      });

    } catch (error) {
      throw new AppError(error.message, error.statusCode || 500);
    }
  }

  async getFeedbacks(req, res) {
    const { instanceId, chapterId } = req.params;

    try {
      // Populate the instance with module master data
      const instance = await ModuleInstance.findOne({
        _id: instanceId,
        userId: req.user.id
      })
        .populate('moduleMasterId', 'chapters');

      await this.verifyInstanceOwnership(instance, req.user.id)
      if (!instance) {
        throw new AppError('Module instance not found', 404);
      }

      // Get the chapter progress index
      const chapterProgress = instance.chapterProgress.find(
        cp => cp.chapterIndex === instance.currentState.currentChapterIndex
      );

      if (!chapterProgress) {
        throw new AppError('Chapter progress not found', 404);
      }

      // Filter adaptive history for the specific chapter
      const relevantFeedback = instance.adaptiveHistory
        .filter(history => {
          // Check if the feedback's questionSetId exists in this chapter's progress
          return chapterProgress.questionSets.some(
            qs => qs.setId.toString() === history.newQuestionSetId.toString()
          );
        })
        .map(history => ({
          feedback: {
            timestamp: history.timestamp,
            understandingAnalysis: {
              strengths: history.understandingAnalysis?.strengths?.map(strength => ({
                topic: strength.topic,
                bloomLevel: strength.bloomLevel,
                demonstratedSkills: strength.demonstratedSkills || []
              })) || [],
              weakAreas: history.understandingAnalysis?.weakAreas?.map(area => ({
                topic: area.topic,
                bloomLevel: area.bloomLevel,
                detectedIssues: area.detectedIssues || [],
                recommendedFocus: area.recommendedFocus
              })) || []
            },
            adaptationDetails: {
              adaptationType: history.adaptationDetails?.adaptationType || 'initial',
              focusAreas: history.adaptationDetails?.focusAreas || [],
              recommendedApproach: history.adaptationDetails?.recommendedApproach || '',
              targetBloomLevels: history.adaptationDetails?.targetBloomLevels?.map(level => ({
                level: level.level,
                percentage: level.percentage
              })) || []
            }
          }
        }));

      // Return the most recent feedback if exists
      const response = relevantFeedback.length > 0
        ? relevantFeedback[relevantFeedback.length - 1]
        : {
          feedback: {
            timestamp: new Date(),
            understandingAnalysis: {
              strengths: [],
              weakAreas: []
            },
            adaptationDetails: {
              adaptationType: "initial",
              focusAreas: [],
              recommendedApproach: "Begin with fundamentals",
              targetBloomLevels: []
            }
          }
        };

      res.status(200).json({
        status: 'success',
        data: response
      });

    } catch (error) {
      console.error('Error in getFeedbacks:', error);
      throw new AppError(error.message || 'Error getting feedbacks', error.statusCode || 500);
    }
  }
}

module.exports = ModuleController;