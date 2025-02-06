const moduleService = require('../services/moduleService');
const { uploadToCloudinary, cloudinary } = require('../config/cloudinary');
const { cleanupFile } = require('../utils/fileUtils');
const { AppError } = require('../middlewares/errorHandler');
const { ModuleMaster } = require('../models/ModuleMaster');
const { ModuleInstance } = require('../models/ModuleInstance');
const { User } = require('../models/User');
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

  async createModule(req, res) {
    const { additionalNotes, preferredLanguage = 'id' } = req.body;
    let cloudinaryResult = null;
    let localFilePath = null;

    try {
      // 1. Initial validations
      if (!req.file) {
        throw new AppError('Please upload a PDF file', 400);
      }

      localFilePath = path.resolve(req.file.path);

      // 2. Quick validations
      const stats = await fs.stat(localFilePath);
      if (stats.size === 0) {
        throw new AppError('Uploaded file is empty', 400);
      }

      if (!req.file.mimetype || req.file.mimetype !== 'application/pdf') {
        throw new AppError('Invalid file type. Please upload a PDF file', 400);
      }

      // 3. Upload to Cloudinary
      cloudinaryResult = await uploadToCloudinary(localFilePath);
      if (!cloudinaryResult || !cloudinaryResult.secure_url) {
        throw new AppError('Failed to upload file to storage', 500);
      }

      // 4. Create initial module with minimal data but with a unique constraint
      const userId = req.user.id;
      const uniqueIdentifier = `${userId}_${Date.now()}`;

      const initialModule = await ModuleMaster.create({
        title: 'Processing...',
        description: 'Module is being processed...',
        excerpt: 'Module content is being generated...',
        createdBy: userId,
        pdfUrl: cloudinaryResult.secure_url,
        status: 'processing',
        subscribedUsers: [userId],
        chapters: [],
        uniqueIdentifier
      });

      // 5. Return early with initial module data
      res.status(201).json({
        status: 'success',
        message: 'Module creation started',
        data: {
          moduleId: initialModule._id,
          status: 'processing'
        }
      });

      // 6. Continue processing in background
      await this.processModuleInBackground(
        initialModule._id,
        localFilePath,
        userId,
        additionalNotes, // Pass additionalNotes instead of title/description
        preferredLanguage,
        cloudinaryResult.secure_url,
        initialModule._id
      );

    } catch (error) {
      // Clean up on error
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

  async processModuleInBackground(
    moduleId,
    pdfPath,
    userId,
    additionalNotes,
    preferredLanguage,
    pdfUrl
) {
    try {
        // Generate module content, passing the existing module ID
        const moduleContent = await moduleService.createModuleWithContent(
            pdfPath,
            userId,
            additionalNotes,  // Pass additionalNotes instead of title/description
            preferredLanguage,
            pdfUrl,
            moduleId  // Pass the existing module ID
        );

        // Clean up the temporary file
        await cleanupFile(pdfPath);

    } catch (error) {
        console.error('Error in background processing:', error);

        // Update module status to error, only if it's still in processing state
        await ModuleMaster.findOneAndUpdate(
            { _id: moduleId, status: 'processing' },
            {
                $set: {
                    status: 'error',
                    errorMessage: error.message
                }
            }
        );

        // Clean up
        try {
            await cleanupFile(pdfPath);
        } catch (cleanupError) {
            console.error('Cleanup error:', cleanupError);
        }
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

  async getInstanceProgress(req, res) {
    const instance = await ModuleInstance.findById(req.params.instanceId)
      .populate({
        path: 'moduleMasterId',
        select: 'title description chapters'
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

    // Calculate overall progress percentage
    const totalChapters = instance.moduleMasterId.chapters.length;
    const completedChapters = instance.chapterProgress.filter(
      chapter => chapter.status === 'completed'
    ).length;

    // Calculate current chapter completion
    let currentChapterPercentage = 0;
    if (currentChapterProgress && currentChapterProgress.questionSets.length > 0) {
      const totalQuestions = currentChapterProgress.questionSets.reduce(
        (sum, set) => sum + set.questions.length, 0
      );
      const completedQuestions = currentChapterProgress.questionSets.reduce(
        (sum, set) => sum + set.questions.filter(q => q.status === 'completed').length, 0
      );
      currentChapterPercentage = (completedQuestions / totalQuestions) * 100;
    }

    // Calculate overall progress
    const overallProgress = (
      (completedChapters * 100 + currentChapterPercentage) /
      (totalChapters * 100)
    ) * 100;

    res.status(200).json({
      status: 'success',
      data: {
        instance: {
          id: instance._id,
          moduleTitle: instance.moduleMasterId.title,
          moduleDescription: instance.moduleMasterId.description,
          currentChapter: {
            index: instance.currentState.currentChapterIndex,
            title: instance.moduleMasterId.chapters[instance.currentState.currentChapterIndex]?.title
          },
          progress: {
            overall: overallProgress,
            currentLevel: instance.currentState.lastAssessmentLevel,
            comprehensionScore: instance.currentState.comprehensionScore,
            chapterProgress: {
              completed: completedChapters,
              total: totalChapters,
              percentage: Math.round((completedChapters / totalChapters) * 100)
            },
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
          status: instance.status,
          lastAccessedAt: instance.lastAccessedAt,
          adaptiveHistory: instance.adaptiveHistory,
          chapters: instance.moduleMasterId.chapters.map(chapter => ({
            id: chapter._id,
            title: chapter.title,
            order: chapter.order,
            status: instance.chapterProgress.find(
              cp => cp.chapterIndex === chapter.order - 1
            )?.status || 'not_started'
          }))
        }
      }
    });
  }
  // Get next set of questions
  async getNextQuestions(req, res) {
    const result = await moduleService.getNextQuestions(req.params.instanceId);

    res.status(201).json({
      status: 'success',
      data: result,
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

  async getFeaturedPublicModules(req, res) {
    try {
      const featuredModules = await ModuleMaster.find({ isActive: true })
        .limit(4)
        .select('title excerpt createdBy subscribedUsers')
        .populate('createdBy', 'username')
        .sort({ 'subscribedUsers': -1, 'createdAt': -1 });

      const transformedModules = featuredModules.map(module => ({
        _id: module._id,
        title: module.title,
        excerpt: module.excerpt,
        createdBy: module.createdBy.username,
        totalSubscribers: module.subscribedUsers?.length || 0
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
        .limit(4)
        .select('title createdBy subscribedUsers')
        .populate('createdBy', 'username')
        .sort('-createdAt');

      const transformedModules = recommendedModules.map(module => ({
        _id: module._id,
        title: module.title,
        createdBy: module.createdBy.username,
        totalSubscribers: module.subscribedUsers?.length || 0,
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

      // Debug: Log the query being used
      console.log('Search Query:', searchQuery);

      const modules = await ModuleMaster.find(searchQuery)
        .select('title description excerpt createdBy subscribedUsers createdAt')
        .populate({
          path: 'createdBy',
          select: 'username'
        })
        .sort('-createdAt')
        .skip((page - 1) * limit)
        .limit(limit);

      // Debug: Log raw modules data
      console.log('Raw Modules Data:', JSON.stringify(modules, null, 2));

      const transformedModules = modules.map(module => {
        // Debug: Log each module before transformation
        console.log('Module before transform:', module);

        return {
          _id: module._id,
          title: module.title,
          description: module.description,
          excerpt: module.excerpt,
          createdBy: module.createdBy?.username || 'Unknown User',
          totalSubscribers: module.subscribedUsers?.length || 0,
          createdAt: module.createdAt
        };
      });

      // Debug: Log transformed modules
      console.log('Transformed Modules:', JSON.stringify(transformedModules, null, 2));

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
      console.error('Error in getAllPublicModules:', error);
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

  async addModuleToCollection(req, res) {
    const { moduleId } = req.params;
    const userId = req.user.id;

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
      await ModuleInstance.create({
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
        message: 'Module added to collection successfully'
      });

    } catch (error) {
      throw new AppError('Failed to add module to collection', 500);
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
      const userId = req.user.id; // Get actual userId from auth

      const instances = await ModuleInstance.find({ userId })
        .populate({
          path: 'moduleMasterId',
          select: 'title description excerpt' // Added excerpt
        })
        .select('status lastAccessedAt moduleMasterId') // Added moduleMasterId
        .sort('-lastAccessedAt')
        .lean();

      // Transform to simpler format for cards
      const formattedInstances = instances.map(instance => ({
        _id: instance._id,
        title: instance.moduleMasterId.title,
        excerpt: instance.moduleMasterId.excerpt, // Added excerpt
        masterId: instance.moduleMasterId._id, // Added masterId
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
    const { page = 1, limit = 10, bloomLevel } = req.query;

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
                    select: 'levels title'
                }
            });

        await this.verifyInstanceOwnership(instance, req.user.id);
        
        if (!instance) {
            throw new AppError('Module instance not found', 404);
        }

        if (!instance.moduleMasterId?.chapters?.length) {
            throw new AppError('Chapter not found', 404);
        }

        const chapter = instance.moduleMasterId.chapters[0];

        // Filter levels by bloomLevel if provided
        let filteredLevels = chapter.levels;
        if (bloomLevel) {
            filteredLevels = chapter.levels.filter(l => l.bloomLevel === parseInt(bloomLevel));
        }

        // Calculate total questions across all filtered levels
        const totalQuestions = filteredLevels.reduce((sum, level) => 
            sum + level.questions.length, 0
        );

        // Calculate total levels
        const totalLevels = chapter.levels.length;

        // Paginate questions
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const endIndex = startIndex + parseInt(limit);

        // Flatten questions from all levels and paginate
        const allQuestions = filteredLevels.reduce((acc, level) => {
            return acc.concat(level.questions.map(q => ({
                ...q.toObject(),
                bloomLevel: level.bloomLevel
            })));
        }, []);

        const paginatedQuestions = allQuestions.slice(startIndex, endIndex);

        // Group paginated questions by level
        const paginatedLevels = paginatedQuestions.reduce((acc, question) => {
            const levelIndex = acc.findIndex(l => l.bloomLevel === question.bloomLevel);
            if (levelIndex === -1) {
                acc.push({
                    bloomLevel: question.bloomLevel,
                    questions: [question]
                });
            } else {
                acc[levelIndex].questions.push(question);
            }
            return acc;
        }, []);

        res.status(200).json({
            status: 'success',
            data: {
                instanceId: instanceId,
                chapterId: chapterId,
                chapterTitle: chapter.title,
                levels: paginatedLevels,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalQuestions / limit),
                    totalQuestions,
                    questionsPerPage: parseInt(limit),
                    totalLevels
                },
                filters: {
                    bloomLevel: bloomLevel ? parseInt(bloomLevel) : null,
                    availableBloomLevels: [...new Set(chapter.levels.map(l => l.bloomLevel))]
                }
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

  async getDashboardModules(req, res) {
    try {
      const userId = req.user.id;
      console.log('Requesting modules for userId:', userId);

      // First get ModuleInstances for this user
      const moduleInstances = await ModuleInstance.find({ userId })
        .select('moduleMasterId currentState chapterProgress')
        .populate({
          path: 'moduleMasterId',
          select: 'title chapters createdBy subscribedUsers'
        })
        .sort('-lastAccessedAt')
        .limit(3);

      console.log('Found module instances:', moduleInstances.length);

      if (!moduleInstances.length) {
        return res.status(200).json({
          status: 'success',
          data: { modules: [] }
        });
      }

      const transformedModules = moduleInstances.map(instance => {
        const module = instance.moduleMasterId;

        // Calculate progress percentage
        let progressPercentage = 0;
        if (instance.chapterProgress && instance.chapterProgress.length > 0) {
          const totalChapters = module.chapters.length;
          const completedChapters = instance.chapterProgress.filter(
            chapter => chapter.status === 'completed'
          ).length;

          // Get current chapter progress
          const currentChapterIndex = instance.currentState.currentChapterIndex;
          const currentChapterProgress = instance.chapterProgress[currentChapterIndex];

          // Calculate current chapter percentage
          let currentChapterPercentage = 0;
          if (currentChapterProgress && currentChapterProgress.questionSets.length > 0) {
            const totalQuestions = currentChapterProgress.questionSets.reduce(
              (sum, set) => sum + set.questions.length, 0
            );
            const completedQuestions = currentChapterProgress.questionSets.reduce(
              (sum, set) => sum + set.questions.filter(q => q.status === 'completed').length, 0
            );
            currentChapterPercentage = (completedQuestions / totalQuestions) * 100;
          }

          // Calculate overall progress
          // Completed chapters contribute 100% each, current chapter contributes its percentage
          progressPercentage = (
            (completedChapters * 100 + currentChapterPercentage) /
            (totalChapters * 100)
          ) * 100;
        }

        return {
          _id: module._id,
          title: module.title,
          createdBy: module.createdBy.username,
          totalSubscribers: module.subscribedUsers?.length || 0,
          progress: Math.round(progressPercentage), // Round to nearest integer
          totalChapters: module.chapters.length,
          completedChapters: instance.chapterProgress.filter(
            chapter => chapter.status === 'completed'
          ).length
        };
      });

      res.status(200).json({
        status: 'success',
        data: { modules: transformedModules }
      });
    } catch (error) {
      console.error('Error in getDashboardModules:', error);
      throw new AppError('Failed to retrieve dashboard modules: ' + error.message, 500);
    }
  }

  async getQuestionDetail(req, res) {
    const { instanceId, chapterId, questionId } = req.params;

    try {
      const instance = await ModuleInstance.findOne({
        _id: instanceId,
        userId: req.user.id
      }).populate({
        path: 'moduleMasterId',
        populate: {
          path: 'chapters',
          match: { _id: chapterId },
          select: 'levels title'
        }
      });

      await this.verifyInstanceOwnership(instance, req.user.id);

      const chapter = instance.moduleMasterId.chapters[0];
      if (!chapter) {
        throw new AppError('Chapter not found', 404);
      }

      // Find the question in any level
      let questionDetail = null;
      let questionLevel = null;

      for (const level of chapter.levels) {
        const question = level.questions.find(q => q._id.toString() === questionId);
        if (question) {
          questionDetail = question;
          questionLevel = level.bloomLevel;
          break;
        }
      }

      if (!questionDetail) {
        throw new AppError('Question not found', 404);
      }

      // Get user's progress for this question if exists
      const chapterProgress = instance.chapterProgress[instance.currentState.currentChapterIndex];
      let userProgress = null;

      if (chapterProgress && chapterProgress.questionSets) {
        for (const set of chapterProgress.questionSets) {
          const progress = set.questions.find(q => q.questionId.toString() === questionId);
          if (progress) {
            userProgress = progress;
            break;
          }
        }
      }

      res.status(200).json({
        status: 'success',
        data: {
          instanceId,
          chapterId,
          questionId,
          chapterTitle: chapter.title,
          question: {
            questionText: questionDetail.question,
            options: questionDetail.options,
            bloomLevel: questionLevel,
            difficultyLevel: questionDetail.difficultyLevel,
            learningObjective: questionDetail.learningObjective,
            targetedConcept: questionDetail.targetedConcept,
            explanation: userProgress?.status === 'completed' ? questionDetail.explanation : null
          },
          progress: userProgress ? {
            status: userProgress.status,
            userAnswer: userProgress.userAnswer,
            isCorrect: userProgress.isCorrect,
            answeredAt: userProgress.answeredAt
          } : null,
          navigation: {
            currentLevel: instance.currentState.lastAssessmentLevel,
            currentChapterIndex: instance.currentState.currentChapterIndex
          }
        }
      });

    } catch (error) {
      throw new AppError(error.message, error.statusCode || 500);
    }
  }
  async getModuleStatus(req, res) {
    const { moduleId } = req.params;

    const module = await ModuleMaster.findById(moduleId)
      .select('status title description errorMessage');

    if (!module) {
      throw new AppError('Module not found', 404);
    }

    res.status(200).json({
      status: 'success',
      data: {
        moduleId: module._id,
        status: module.status,
        title: module.title,
        description: module.description,
        errorMessage: module.errorMessage
      }
    });
  }
}

module.exports = ModuleController;