// src/services/moduleService.js
require('dotenv').config();
const { ModuleMaster } = require('../models/ModuleMaster');
const { ModuleInstance } = require('../models/ModuleInstance')
const geminiConfig = require('../config/gemini');
const { AppError } = require('../middlewares/errorHandler');
const { processAIResponse } = require('../utils/aiResponseHelper');
const fs = require('fs').promises;
const mongoose = require('mongoose');
const axios = require('axios');
const { GoogleAICacheManager } = require('@google/generative-ai/server');
const {
    MODULE_METADATA_PROMPT,
    CHAPTER_IDENTIFICATION_PROMPT,
    FLASHCARD_GENERATION_PROMPT,
    ASSESSMENT_GENERATION_PROMPT,
    EVALUATION_PROMPT,
    ADAPTIVE_CONTENT_PROMPT
} = require('./ai/prompts/modulePrompts');
const { configDotenv } = require('dotenv');
const cloudinary = require('cloudinary').v2;

class ModuleService {
    constructor() {
        this.cacheManager = new GoogleAICacheManager(process.env.GEMINI_API_KEY);
    }

    async createModule(pdfPath, userId, title, description, preferredLanguage, pdfUrl) {
        let cache = null;
        try {
            // 1. First verify the PDF file exists and is not empty
            const stats = await fs.stat(pdfPath);
            if (stats.size === 0) {
                throw new AppError('PDF file is empty', 400);
            }

            // 2. Read the file with proper error handling
            const fileBuffer = await fs.readFile(pdfPath);
            if (!fileBuffer || fileBuffer.length === 0) {
                throw new AppError('Failed to read PDF file', 400);
            }

            // 3. Upload to Cloudinary first to ensure file is valid
            const cloudinaryResult = await new Promise((resolve, reject) => {
                cloudinary.uploader.upload(pdfPath, {
                    resource_type: 'raw',
                    folder: 'adaptive-learning',
                    public_id: `module-${Date.now()}`,
                    format: 'pdf',
                    // Add validation
                    invalidate: true,
                    validation: {
                        allowed_formats: ['pdf']
                    }
                }, (error, result) => {
                    if (error) reject(new AppError(`Cloudinary upload failed: ${error.message}`, 500));
                    resolve(result);
                });
            });

            // 4. Verify Cloudinary upload was successful
            if (!cloudinaryResult || !cloudinaryResult.secure_url) {
                throw new AppError('Failed to upload PDF to storage', 500);
            }

            // 5. Create base64 data for Gemini
            const base64Data = fileBuffer.toString('base64');
            const actualUserId = userId || new mongoose.Types.ObjectId();

            // 6. Create Gemini cache with validation
            cache = await this.cacheManager.create({
                model: 'models/gemini-1.5-flash-002',
                displayName: `temp-module-${Date.now()}`,
                contents: [{
                    role: 'user',
                    parts: [{
                        inlineData: {
                            mimeType: "application/pdf",
                            data: base64Data
                        }
                    }]
                }],
                ttlSeconds: 3600
            });

            // 7. Verify cache creation
            if (!cache || !cache.name) {
                throw new AppError('Failed to create AI cache', 500);
            }

            // 8. Get AI model
            const model = geminiConfig.genAI.getGenerativeModelFromCachedContent(cache);

            // 9. Generate metadata and chapters with error handling
            const [metadataResult, chapterResult] = await Promise.all([
                model.generateContent({
                    contents: [{
                        role: 'user',
                        parts: [{
                            text: `Language: ${preferredLanguage}\n${MODULE_METADATA_PROMPT}`
                        }]
                    }]
                }).catch(error => {
                    throw new AppError(`Metadata generation failed: ${error.message}`, 500);
                }),
                model.generateContent({
                    contents: [{
                        role: 'user',
                        parts: [{
                            text: `Language: ${preferredLanguage}\n${CHAPTER_IDENTIFICATION_PROMPT}`
                        }]
                    }]
                }).catch(error => {
                    throw new AppError(`Chapter identification failed: ${error.message}`, 500);
                })
            ]);

            // 10. Process AI responses
            const metadata = processAIResponse(metadataResult.response.text(), 'metadata');
            const chapters = processAIResponse(chapterResult.response.text(), 'chapters');

            // 11. Prepare module data
            const moduleData = {
                title: title || metadata.title,
                description: description || metadata.description,
                excerpt: chapters[0]?.excerpt || metadata.excerpt,
                createdBy: actualUserId,
                pdfUrl: cloudinaryResult.secure_url, // Use the verified Cloudinary URL
                chapters: chapters.map(chapter => ({
                    title: chapter.title,
                    order: chapter.order,
                    excerpt: chapter.excerpt,
                    summaries: [],
                    levels: []
                })),
                subscribedUsers: [actualUserId],
                metadata: {
                    caches: [{
                        userId: actualUserId,
                        cacheName: cache.name,
                        expiresAt: new Date(Date.now() + 3600000)
                    }]
                }
            };

            // 12. Create module in database
            const createdModule = await ModuleMaster.create(moduleData);

            // 13. Clean up temporary file
            await fs.unlink(pdfPath).catch(console.error);

            return createdModule;

        } catch (error) {
            // Clean up on error
            if (cache?.name) {
                await this.cacheManager.delete(cache.name).catch(console.error);
            }
            // Clean up temporary file even if there's an error
            await fs.unlink(pdfPath).catch(console.error);

            throw new AppError(`Failed to create module: ${error.message}`, error.statusCode || 500);
        }
    }

    // In generateChapterContent method of moduleService.js
    async generateChapterContent(moduleId, chapterId, userId, preferredLanguage) {
        try {
            const module = await ModuleMaster.findById(moduleId);
            if (!module) throw new AppError('Module not found', 404);

            const chapter = module.chapters.id(chapterId);
            if (!chapter) throw new AppError('Chapter not found', 404);

            // Check for existing cache
            const userCache = module.metadata.caches.find(c =>
                c.userId.toString() === userId.toString() &&
                new Date(c.expiresAt) > new Date()
            );

            if (!userCache) {
                throw new AppError('PDF context expired or not found. Please reload the module.', 400);
            }

            // Get model with cached content - Add model name here
            const model = geminiConfig.genAI.getGenerativeModelFromCachedContent({
                model: "gemini-1.5-flash-002",  // Add this line
                name: userCache.cacheName
            });

            // Generate flashcards
            const flashcardsResult = await model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [{ text: `${FLASHCARD_GENERATION_PROMPT}\nChapter: ${chapter.title}\nLanguage: ${preferredLanguage}` }]
                }]
            });

            const flashcards = processAIResponse(flashcardsResult.response.text(), 'flashcards');
            chapter.summaries = flashcards;

            // Generate assessment questions
            const questionsResult = await model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [{ text: `${ASSESSMENT_GENERATION_PROMPT}\nChapter: ${chapter.title}\nLanguage: ${preferredLanguage}` }]
                }]
            });

            const questions = processAIResponse(questionsResult.response.text(), 'questions');

            // Group questions by Bloom's level
            const questionsByLevel = questions.reduce((acc, q) => {
                if (!acc[q.bloomLevel]) acc[q.bloomLevel] = [];
                acc[q.bloomLevel].push(q);
                return acc;
            }, {});

            chapter.levels = Object.entries(questionsByLevel).map(([level, questions]) => ({
                bloomLevel: parseInt(level),
                questions
            }));

            await module.save();
            return chapter;

        } catch (error) {
            console.error('Error generating chapter content:', error);
            throw new AppError('Failed to generate chapter content: ' + error.message, 500);
        }
    }

    async evaluateAndAdapt(moduleInstanceId, answers, preferredLanguage) {
        try {
            const instance = await ModuleInstance.findById(moduleInstanceId)
                .populate({
                    path: 'moduleMasterId',
                    populate: { path: 'metadata.caches' }
                });

            if (!instance) throw new AppError('Module instance not found', 404);

            // Get latest valid cache
            let latestCache = instance.moduleMasterId.metadata?.caches
                ?.find(c => new Date(c.expiresAt) > new Date());

            if (!latestCache && instance.moduleMasterId.pdfUrl) {
                console.log('Cache expired or not found, attempting to refresh...');
                const newCache = await this.refreshCache(
                    instance.moduleMasterId._id,
                    instance.userId,
                    instance.moduleMasterId.pdfUrl
                );
                latestCache = {
                    cacheName: newCache.name,
                    userId: instance.userId,
                    expiresAt: new Date(Date.now() + 3600000)
                };
            }

            if (!latestCache) {
                throw new AppError('Could not access or refresh PDF content', 400);
            }

            // Get model with cached content
            const model = geminiConfig.genAI.getGenerativeModelFromCachedContent({
                model: "gemini-1.5-flash-002",
                name: latestCache.cacheName
            });

            // First evaluate performance
            const evalResult = await model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [{
                        text: `Using the PDF content as context for this evaluation.\n\n${EVALUATION_PROMPT
                            .replace('{currentLevel}', instance.currentState.lastAssessmentLevel)
                            .replace('{questionCount}', answers.length)
                            .replace('{correctCount}', answers.filter(a => a.isCorrect).length)
                            }\n\nDetailed Answers: ${JSON.stringify(answers)}\nPreferred Language: ${preferredLanguage}`
                    }]
                }]
            });

            const evaluation = processAIResponse(evalResult.response.text(), 'evaluation');

            let newQuestions = [];
            let newFlashcards = [];

            if (evaluation.needsAdaptation) {
                // Generate adaptive content using cached context
                const adaptiveResult = await model.generateContent({
                    contents: [{
                        role: 'user',
                        parts: [{
                            text: `Using the PDF content as context.\n\n${ADAPTIVE_CONTENT_PROMPT
                                .replace('{targetLevel}', evaluation.recommendedLevel)
                                .replace('{focusAreas}', JSON.stringify(evaluation.adaptationStrategy.focusAreas))
                                .replace('{weakConcepts}', JSON.stringify(evaluation.weakAreas))
                                }\nPreferred Language: ${preferredLanguage}\n\nCurrent Chapter: ${instance.moduleMasterId.chapters[instance.currentState.currentChapterIndex].title}`
                        }]
                    }]
                });

                const adaptiveContent = processAIResponse(adaptiveResult.response.text(), 'questions');

                if (adaptiveContent.questions?.length > 0) {
                    // Update ModuleMaster with new questions
                    await ModuleMaster.findOneAndUpdate(
                        {
                            _id: instance.moduleMasterId._id,
                            'chapters.order': instance.currentState.currentChapterIndex
                        },
                        {
                            $push: {
                                'chapters.$.levels': {
                                    bloomLevel: evaluation.recommendedLevel,
                                    questions: adaptiveContent.questions
                                }
                            }
                        }
                    );
                    newQuestions = adaptiveContent.questions;
                }

                if (adaptiveContent.newFlashcards?.length > 0) {
                    // Update ModuleMaster with new flashcards
                    await ModuleMaster.findOneAndUpdate(
                        {
                            _id: instance.moduleMasterId._id,
                            'chapters.order': instance.currentState.currentChapterIndex
                        },
                        {
                            $push: {
                                'chapters.$.summaries': {
                                    $each: adaptiveContent.newFlashcards
                                }
                            }
                        }
                    );
                    newFlashcards = adaptiveContent.newFlashcards;
                }
            }

            // Update instance state and adaptive history
            await ModuleInstance.findOneAndUpdate(
                { _id: moduleInstanceId },
                {
                    $set: {
                        'currentState.comprehensionScore': evaluation.score,
                        'currentState.lastAssessmentLevel': evaluation.recommendedLevel
                    },
                    $push: {
                        adaptiveHistory: {
                            previousLevel: instance.currentState.lastAssessmentLevel,
                            newLevel: evaluation.recommendedLevel,
                            assessmentScore: evaluation.score,
                            generatedQuestions: newQuestions.map(q => q._id),
                            generatedFlashcards: newFlashcards.map(f => f._id),
                            understandingAnalysis: {
                                strengths: evaluation.strengths || [],
                                weakAreas: evaluation.weakAreas || []
                            },
                            adaptationStrategy: evaluation.adaptationStrategy || {},
                            timestamp: new Date()
                        }
                    }
                }
            );

            return {
                evaluation: {
                    ...evaluation,
                    newContent: {
                        questions: newQuestions,
                        flashcards: newFlashcards
                    }
                },
                instanceState: {
                    currentLevel: evaluation.recommendedLevel,
                    comprehensionScore: evaluation.score,
                    needsAdaptation: evaluation.needsAdaptation
                }
            };

        } catch (error) {
            console.error('Error in evaluation and adaptation:', error);
            throw new AppError('Failed to evaluate and adapt: ' + error.message, 500);
        }
    }

    async getNextQuestions(instanceId, count = 5) {
        try {
            const instance = await ModuleInstance.findById(instanceId)
                .populate('moduleMasterId');

            if (!instance) throw new AppError('Module instance not found', 404);

            const currentChapter = instance.moduleMasterId.chapters[instance.currentState.currentChapterIndex];

            // Get all pending questions from currentQuestions
            const pendingQuestions = instance.progress.currentQuestions
                .filter(q => q.status === 'pending')
                .slice(0, count);

            if (pendingQuestions.length === 0) {
                throw new AppError('No more pending questions available', 404);
            }

            // Map pending questions to full question data
            const questionsWithDetails = pendingQuestions.map(pendingQ => {
                const level = currentChapter.levels.find(
                    l => l.bloomLevel === pendingQ.bloomLevel
                );

                const fullQuestion = level?.questions.find(
                    q => q._id.toString() === pendingQ.questionId.toString()
                );

                return {
                    ...pendingQ.toObject(),
                    question: fullQuestion?.question,
                    options: fullQuestion?.options
                };
            });

            return {
                questions: questionsWithDetails,
                currentLevel: instance.currentState.lastAssessmentLevel,
                progress: {
                    completedQuestions: instance.progress.currentQuestions.filter(
                        q => q.status === 'completed'
                    ).length,
                    totalQuestions: instance.progress.currentQuestions.length,
                    pendingQuestions: pendingQuestions.length
                }
            };
        } catch (error) {
            console.error('Error getting next questions:', error);
            throw new AppError('Failed to get next questions: ' + error.message, 500);
        }
    }

    async refreshCache(moduleId, userId, pdfUrl) {
        let cache = null;
        try {
            console.log('Refreshing cache for module:', moduleId);

            // Parse the Cloudinary URL components
            const urlParts = pdfUrl.split('/');
            const version = urlParts.find(part => part.startsWith('v')); // e.g., 'v1738425310'
            const folder = 'adaptive-learning';
            const filename = urlParts[urlParts.length - 1]; // Gets the full filename with extension
            const publicId = `${folder}/${filename.replace('.pdf', '')}`; // Includes folder in public_id

            // Generate authentication parameters
            const timestamp = Math.round(new Date().getTime() / 1000);

            // Parameters for signing
            const params = {
                timestamp: timestamp,
                public_id: publicId,
                resource_type: 'raw',
                type: 'upload',
                version: version?.replace('v', '') // Remove 'v' prefix if present
            };

            // Generate signature
            const signature = cloudinary.utils.api_sign_request(
                params,
                process.env.CLOUDINARY_API_SECRET
            );

            // Construct secure download URL with all components
            const downloadUrl = cloudinary.url(publicId, {
                resource_type: 'raw',
                type: 'upload',
                version: version?.replace('v', ''),
                timestamp: timestamp,
                signature: signature,
                secure: true,
                format: 'pdf'
            });

            console.log('Constructed download URL:', downloadUrl);

            // Fetch the PDF
            const response = await axios.get(downloadUrl, {
                responseType: 'arraybuffer',
                headers: {
                    'Accept': 'application/pdf'
                }
            });

            // Convert to base64
            const base64Data = Buffer.from(response.data).toString('base64');

            // Create cache with Gemini
            cache = await this.cacheManager.create({
                model: 'models/gemini-1.5-flash-002',
                displayName: `temp-module-${Date.now()}`,
                contents: [{
                    role: 'user',
                    parts: [{
                        inlineData: {
                            mimeType: "application/pdf",
                            data: base64Data
                        }
                    }]
                }],
                ttlSeconds: 3600
            });

            // Update module with new cache info
            const updatedModule = await ModuleMaster.findByIdAndUpdate(moduleId, {
                $push: {
                    'metadata.caches': {
                        userId,
                        cacheName: cache.name,
                        expiresAt: new Date(Date.now() + 3600000)
                    }
                }
            }, { new: true });

            console.log('Cache refreshed successfully:', cache.name);
            return cache;

        } catch (error) {
            console.error('Error refreshing cache:', error);
            if (cache?.name) {
                await this.cacheManager.delete(cache.name).catch(console.error);
            }
            throw new AppError(`Failed to refresh cache: ${error.message}`, 500);
        }
    };

    async getInitialQuestions(moduleId) {
        try {
            const moduleMaster = await ModuleMaster.findById(moduleId);
            if (!moduleMaster) {
                throw new Error('Module master not found');
            }

            // Get all questions from the module
            const allQuestions = moduleMaster.questions || [];

            // Group questions by Bloom's level
            const questionsByLevel = {};
            for (let i = 1; i <= 6; i++) {
                questionsByLevel[i] = allQuestions.filter(q => q.bloomLevel === i);
            }

            // Select questions based on distribution:
            // 2 questions each from levels 1-4
            // 1 question each from levels 5-6
            let selectedQuestions = [];

            // Get 2 questions from levels 1-4
            for (let level = 1; level <= 4; level++) {
                const levelQuestions = questionsByLevel[level] || [];
                const shuffled = levelQuestions.sort(() => Math.random() - 0.5);
                selectedQuestions = [...selectedQuestions, ...shuffled.slice(0, 2)];
            }

            // Get 1 question from levels 5-6
            for (let level = 5; level <= 6; level++) {
                const levelQuestions = questionsByLevel[level] || [];
                const shuffled = levelQuestions.sort(() => Math.random() - 0.5);
                selectedQuestions = [...selectedQuestions, ...shuffled.slice(0, 1)];
            }

            // Shuffle final selection
            selectedQuestions = selectedQuestions.sort(() => Math.random() - 0.5);

            return selectedQuestions;
        } catch (error) {
            throw new Error(`Failed to get initial questions: ${error.message}`);
        }
    };
}

module.exports = new ModuleService();