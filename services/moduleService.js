require('dotenv').config();
const { ModuleMaster } = require('../models/ModuleMaster');
const { ModuleInstance } = require('../models/ModuleInstance');
const geminiConfig = require('../config/gemini');
const { AppError } = require('../middlewares/errorHandler');
const { processAIResponse } = require('../utils/aiResponseHelper');
const fs = require('fs').promises;
const mongoose = require('mongoose');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const {
    MODULE_METADATA_PROMPT,
    CHAPTER_IDENTIFICATION_PROMPT,
    FLASHCARD_GENERATION_PROMPT,
    ASSESSMENT_GENERATION_PROMPT,
    EVALUATION_PROMPT,
    ADAPTIVE_CONTENT_PROMPT
} = require('./ai/prompts/modulePrompts');

class ModuleService {
    constructor() {
        this.model = geminiConfig.genAI.getGenerativeModel({
            model: "gemini-2.0-flash-exp"
        });
    }

    async getPDFContent(pdfUrl) {
        try {
            // Parse the Cloudinary URL components
            const urlParts = pdfUrl.split('/');
            const version = urlParts.find(part => part.startsWith('v'));
            const folder = 'adaptive-learning';
            const filename = urlParts[urlParts.length - 1];
            const publicId = `${folder}/${filename.replace('.pdf', '')}`;

            // Generate authentication parameters
            const timestamp = Math.round(new Date().getTime() / 1000);
            const params = {
                timestamp: timestamp,
                public_id: publicId,
                resource_type: 'raw',
                type: 'upload',
                version: version?.replace('v', '')
            };

            // Generate signature
            const signature = cloudinary.utils.api_sign_request(
                params,
                process.env.CLOUDINARY_API_SECRET
            );

            // Construct secure download URL
            const downloadUrl = cloudinary.url(publicId, {
                resource_type: 'raw',
                type: 'upload',
                version: version?.replace('v', ''),
                timestamp: timestamp,
                signature: signature,
                secure: true,
                format: 'pdf'
            });

            // Fetch the PDF
            const response = await axios.get(downloadUrl, {
                responseType: 'arraybuffer',
                headers: {
                    'Accept': 'application/pdf'
                }
            });

            // Convert to base64
            return Buffer.from(response.data).toString('base64');
        } catch (error) {
            console.error('Error fetching PDF content:', error);
            throw new AppError(`Failed to fetch PDF content: ${error.message}`, 500);
        }
    }

    async createModule(pdfPath, userId, title, description, preferredLanguage, pdfUrl) {
        try {
            // 1. First verify the PDF file exists and is not empty
            const stats = await fs.stat(pdfPath);
            if (stats.size === 0) {
                throw new AppError('PDF file is empty', 400);
            }

            // 2. Read the file
            const fileBuffer = await fs.readFile(pdfPath);
            const base64Data = fileBuffer.toString('base64');

            // 3. Generate metadata and chapters using Gemini
            const [metadataResult, chapterResult] = await Promise.all([
                this.model.generateContent({
                    contents: [{
                        role: 'user',
                        parts: [{
                            text: `Language: ${preferredLanguage}\n${MODULE_METADATA_PROMPT}`
                        }, {
                            inlineData: {
                                mimeType: "application/pdf",
                                data: base64Data
                            }
                        }]
                    }]
                }),
                this.model.generateContent({
                    contents: [{
                        role: 'user',
                        parts: [{
                            text: `Language: ${preferredLanguage}\n${CHAPTER_IDENTIFICATION_PROMPT}`
                        }, {
                            inlineData: {
                                mimeType: "application/pdf",
                                data: base64Data
                            }
                        }]
                    }]
                })
            ]);

            // 4. Process AI responses
            const metadata = processAIResponse(metadataResult.response.text(), 'metadata');
            const chapters = processAIResponse(chapterResult.response.text(), 'chapters');

            // 5. Prepare module data
            const moduleData = {
                title: title || metadata.title,
                description: description || metadata.description,
                excerpt: chapters[0]?.excerpt || metadata.excerpt,
                createdBy: userId,
                pdfUrl: pdfUrl,
                chapters: chapters.map(chapter => ({
                    title: chapter.title,
                    order: chapter.order,
                    excerpt: chapter.excerpt,
                    summaries: [],
                    levels: []
                })),
                subscribedUsers: [userId]
            };

            // 6. Create module in database
            const createdModule = await ModuleMaster.create(moduleData);

            // 7. Clean up temporary file
            await fs.unlink(pdfPath).catch(console.error);

            return createdModule;

        } catch (error) {
            // Clean up temporary file even if there's an error
            await fs.unlink(pdfPath).catch(console.error);
            throw new AppError(`Failed to create module: ${error.message}`, error.statusCode || 500);
        }
    }

    // In moduleService.js
    async generateChapterContent(moduleId, chapterId, userId, preferredLanguage) {
        try {
            const module = await ModuleMaster.findById(moduleId);
            if (!module) throw new AppError('Module not found', 404);

            const chapter = module.chapters.id(chapterId);
            if (!chapter) throw new AppError('Chapter not found', 404);

            // Get PDF content
            const pdfContent = await this.getPDFContent(module.pdfUrl);

            // Generate flashcards with PDF context
            const flashcardsResult = await this.model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [
                        {
                            text: `${FLASHCARD_GENERATION_PROMPT}\nChapter: ${chapter.title}\nLanguage: ${preferredLanguage}`
                        },
                        {
                            inlineData: {
                                mimeType: "application/pdf",
                                data: pdfContent
                            }
                        }
                    ]
                }]
            });

            const flashcards = processAIResponse(flashcardsResult.response.text(), 'flashcards');

            // Map flashcards to ensure all fields are properly included
            const processedFlashcards = flashcards.map(card => ({
                content: card.content,
                comprehensionLevel: card.comprehensionLevel,
                flashcardFront: card.flashcardFront,
                flashcardBack: card.flashcardBack,
                relatedConcepts: card.relatedConcepts || [],  // Ensure this field is included
                practicePrompt: card.practicePrompt || '',    // Ensure this field is included
                adaptiveFor: card.adaptiveFor || null         // Include adaptive metadata if present
            }));

            chapter.summaries = processedFlashcards;

            // Generate assessment questions with PDF context
            const questionsResult = await this.model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [
                        {
                            text: `${ASSESSMENT_GENERATION_PROMPT}\nChapter: ${chapter.title}\nLanguage: ${preferredLanguage}`
                        },
                        {
                            inlineData: {
                                mimeType: "application/pdf",
                                data: pdfContent
                            }
                        }
                    ]
                }]
            });

            const questions = processAIResponse(questionsResult.response.text(), 'questions');

            // Group questions by Bloom's level and ensure all required fields
            const questionsByLevel = questions.reduce((acc, q) => {
                const processedQuestion = {
                    ...q,
                    difficultyLevel: q.difficultyLevel || 1,
                    learningObjective: q.learningObjective || `Understand ${q.targetedConcept || 'the concept'}`,
                    targetedConcept: q.targetedConcept || 'Core concept'
                };

                if (!acc[q.bloomLevel]) acc[q.bloomLevel] = [];
                acc[q.bloomLevel].push(processedQuestion);
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

    async startModuleInstance(moduleId, userId) {
        try {
            const module = await ModuleMaster.findById(moduleId);
            if (!module) throw new AppError('Module not found', 404);

            const initialChapter = module.chapters[0];
            if (!initialChapter) throw new AppError('Chapter not found', 404);

            // Define the ideal distribution of questions
            const questionDistribution = [
                { level: 1, count: 2 },
                { level: 2, count: 2 },
                { level: 3, count: 2 },
                { level: 4, count: 2 },
                { level: 5, count: 1 },
                { level: 6, count: 1 }
            ];

            // Generate initial questions
            const generatedQuestions = await this.generateQuestions(
                module,
                initialChapter,
                questionDistribution
            );

            // Create and save the question set
            const questionSet = {
                setNumber: 1,
                type: 'initial',
                questions: generatedQuestions,
                bloomLevelDistribution: questionDistribution.reduce((acc, item) => {
                    acc[`level${item.level}`] = item.count;
                    return acc;
                }, {})
            };

            // Add question set to chapter
            if (!initialChapter.questionSets) {
                initialChapter.questionSets = [];
            }
            initialChapter.questionSets.push(questionSet);

            // Save the module to get the question set ID
            await module.save();

            // Get the saved question set
            const savedQuestionSet = initialChapter.questionSets[initialChapter.questionSets.length - 1];

            // Create instance with the saved question set
            const instance = await ModuleInstance.create({
                moduleMasterId: moduleId,
                userId,
                currentState: {
                    currentChapterIndex: 0,
                    currentLevelIndex: 0,
                    comprehensionScore: 0,
                    lastAssessmentLevel: 1,
                    currentQuestionSetId: savedQuestionSet._id
                },
                chapterProgress: [{
                    chapterIndex: 0,
                    status: 'in_progress',
                    questionSets: [{
                        setId: savedQuestionSet._id,
                        setNumber: 1,
                        type: 'initial',
                        questions: savedQuestionSet.questions.map(q => ({
                            questionId: q._id,
                            status: 'pending'
                        }))
                    }]
                }]
            });

            return instance;
        } catch (error) {
            console.error('Error starting module instance:', error);
            throw new AppError(`Failed to start module instance: ${error.message}`, 500);
        }
    }

    async evaluateAndAdapt(instanceId, answers, preferredLanguage) {
        try {
            // Input validation
            if (!instanceId || !answers || !Array.isArray(answers)) {
                throw new AppError('Invalid input parameters', 400);
            }

            // Load and validate instance
            const instance = await ModuleInstance.findById(instanceId)
                .populate({
                    path: 'moduleMasterId',
                    populate: {
                        path: 'chapters',
                        populate: {
                            path: 'questionSets levels.questions',
                            select: 'setNumber type questionRefs bloomLevelDistribution adaptationMetadata question options correctAnswer explanation bloomLevel targetedConcept'
                        }
                    }
                });

            if (!instance || !instance.currentState) {
                throw new AppError('Invalid instance or state', 404);
            }

            // Get current chapter and validate
            const currentChapter = instance.moduleMasterId.chapters[instance.currentState.currentChapterIndex];
            if (!currentChapter) {
                throw new AppError('Current chapter not found', 404);
            }

            // Get current question set and validate
            const currentQuestionSet = currentChapter.questionSets.find(qs =>
                qs._id.toString() === instance.currentState.currentQuestionSetId.toString()
            );
            if (!currentQuestionSet) {
                throw new AppError('Question set not found', 404);
            }

            // Get PDF content for AI evaluation
            const pdfContent = await this.getPDFContent(instance.moduleMasterId.pdfUrl);

            // Update answer progress first
            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    // Update individual question statuses
                    for (const answer of answers) {
                        const isCorrect = currentQuestionSet.questionRefs.find(
                            ref => ref.questionId.toString() === answer.questionId.toString()
                        )?.correctAnswer === answer.selectedOption;

                        await ModuleInstance.updateOne(
                            {
                                _id: instanceId,
                                'chapterProgress.chapterIndex': instance.currentState.currentChapterIndex,
                                'chapterProgress.questionSets.setId': instance.currentState.currentQuestionSetId,
                                'chapterProgress.questionSets.questions.questionId': answer.questionId
                            },
                            {
                                $set: {
                                    'chapterProgress.$[chapter].questionSets.$[qset].questions.$[question].status': 'completed',
                                    'chapterProgress.$[chapter].questionSets.$[qset].questions.$[question].userAnswer': answer.selectedOption,
                                    'chapterProgress.$[chapter].questionSets.$[qset].questions.$[question].isCorrect': isCorrect,
                                    'chapterProgress.$[chapter].questionSets.$[qset].questions.$[question].answeredAt': new Date()
                                }
                            },
                            {
                                arrayFilters: [
                                    { 'chapter.chapterIndex': instance.currentState.currentChapterIndex },
                                    { 'qset.setId': instance.currentState.currentQuestionSetId },
                                    { 'question.questionId': answer.questionId }
                                ]
                            }
                        );
                    }

                    // Update question set status if all questions are answered
                    const allQuestionsAnswered = answers.length === currentQuestionSet.questionRefs.length;
                    if (allQuestionsAnswered) {
                        await ModuleInstance.updateOne(
                            {
                                _id: instanceId,
                                'chapterProgress.chapterIndex': instance.currentState.currentChapterIndex,
                                'chapterProgress.questionSets.setId': instance.currentState.currentQuestionSetId
                            },
                            {
                                $set: {
                                    'chapterProgress.$[chapter].questionSets.$[qset].status': 'completed',
                                    'chapterProgress.$[chapter].questionSets.$[qset].completedAt': new Date()
                                }
                            },
                            {
                                arrayFilters: [
                                    { 'chapter.chapterIndex': instance.currentState.currentChapterIndex },
                                    { 'qset.setId': instance.currentState.currentQuestionSetId }
                                ]
                            }
                        );
                    }
                });
            } finally {
                session.endSession();
            }

            // Get evaluation results
            const evaluation = await this.evaluatePerformance(
                instance,
                currentChapter,
                currentQuestionSet,
                answers,
                pdfContent,
                preferredLanguage
            );

            console.log('Evaluation results:', {
                score: evaluation.score,
                recommendedLevel: evaluation.recommendedLevel,
                adaptationType: evaluation.adaptationType,
                currentChapterIndex: instance.currentState.currentChapterIndex,
                totalChapters: instance.moduleMasterId.chapters.length
            });

            // Check for chapter progression
            const isLastChapter = instance.currentState.currentChapterIndex === instance.moduleMasterId.chapters.length - 1;
            const isReadyForNextChapter = evaluation.adaptationType === 'chapter_progress' && !isLastChapter;

            if (isReadyForNextChapter) {
                console.log('Initiating chapter progression');
                const nextChapterIndex = instance.currentState.currentChapterIndex + 1;
                const nextChapter = instance.moduleMasterId.chapters[nextChapterIndex];

                // Mark current chapter as completed first
                await ModuleInstance.updateOne(
                    { _id: instanceId },
                    {
                        $set: {
                            [`chapterProgress.${instance.currentState.currentChapterIndex}.status`]: 'completed'
                        }
                    }
                );

                // Generate initial questions for next chapter
                const questionDistribution = [
                    { level: 1, count: 2 },
                    { level: 2, count: 2 },
                    { level: 3, count: 2 },
                    { level: 4, count: 2 },
                    { level: 5, count: 1 },
                    { level: 6, count: 1 }
                ];

                // Get all available questions from next chapter
                const availableQuestions = nextChapter.levels.reduce((acc, level) => {
                    acc.push(...level.questions.map(q => ({
                        questionId: q._id,
                        bloomLevel: level.bloomLevel,
                        targetedConcept: q.targetedConcept
                    })));
                    return acc;
                }, []);

                // Create new question set
                const newQuestionSet = {
                    _id: new mongoose.Types.ObjectId(),
                    setNumber: 1,
                    type: 'initial',
                    questionRefs: this.distributeQuestions(availableQuestions, questionDistribution),
                    bloomLevelDistribution: questionDistribution.reduce((acc, item) => {
                        acc[`level${item.level}`] = item.count;
                        return acc;
                    }, {})
                };

                // Add question set to next chapter
                await ModuleMaster.updateOne(
                    {
                        _id: instance.moduleMasterId._id,
                        'chapters._id': nextChapter._id
                    },
                    {
                        $push: {
                            'chapters.$.questionSets': newQuestionSet
                        }
                    }
                );

                // Create new chapter progress
                const newChapterProgress = {
                    chapterIndex: nextChapterIndex,
                    status: 'in_progress',
                    questionSets: [{
                        setId: newQuestionSet._id,
                        setNumber: 1,
                        type: 'initial',
                        status: 'not_started',
                        questions: newQuestionSet.questionRefs.map(ref => ({
                            questionId: ref.questionId,
                            status: 'pending'
                        }))
                    }]
                };

                // Update instance state
                await ModuleInstance.updateOne(
                    { _id: instanceId },
                    {
                        $set: {
                            'currentState.currentChapterIndex': nextChapterIndex,
                            'currentState.currentLevelIndex': 0,
                            'currentState.lastAssessmentLevel': 1,
                            'currentState.currentQuestionSetId': newQuestionSet._id,
                        },
                        $push: {
                            chapterProgress: newChapterProgress
                        }
                    }
                );

                return {
                    evaluation: {
                        ...evaluation,
                        chapterProgression: true,
                        nextChapter: {
                            index: nextChapterIndex,
                            title: nextChapter.title
                        }
                    },
                    adaptiveContent: {
                        questionSetId: newQuestionSet._id,
                        type: 'initial',
                        questions: newQuestionSet.questionRefs,
                        flashcardIds: []
                    }
                };
            } else {
                // Generate adaptive content for current chapter
                console.log('Generating adaptive content');
                const adaptiveContent = await this.generateAdaptiveContent(
                    instance,
                    currentChapter,
                    evaluation,
                    pdfContent,
                    preferredLanguage
                );

                const newQuestionSet = {
                    _id: new mongoose.Types.ObjectId(),
                    setNumber: currentChapter.questionSets.length + 1,
                    type: 'adaptive',
                    questionRefs: adaptiveContent.questionRefs,
                    bloomLevelDistribution: evaluation.adaptationStrategy.questionDistribution.reduce((acc, item) => {
                        acc[`level${item.bloomLevel}`] = item.count;
                        return acc;
                    }, {}),
                    adaptationMetadata: {
                        ...adaptiveContent.adaptationMetadata,
                        adaptationType: evaluation.adaptationType,
                        previousScore: evaluation.score,
                        recommendedLevel: evaluation.recommendedLevel
                    }
                };

                // Save new content
                await ModuleMaster.updateOne(
                    {
                        _id: instance.moduleMasterId._id,
                        'chapters._id': currentChapter._id
                    },
                    {
                        $push: {
                            'chapters.$.questionSets': newQuestionSet,
                            'chapters.$.summaries': adaptiveContent.newFlashcards
                        }
                    }
                );

                // Update instance progress
                await this.updateInstanceProgress(
                    instance,
                    evaluation,
                    newQuestionSet,
                    adaptiveContent
                );

                return {
                    evaluation,
                    adaptiveContent: {
                        questionSetId: newQuestionSet._id,
                        type: 'adaptive',
                        questions: adaptiveContent.questionRefs,
                        flashcardIds: adaptiveContent.newFlashcards.map(f => f._id)
                    }
                };
            }
        } catch (error) {
            console.error('Error in evaluateAndAdapt:', error);
            throw new AppError('Failed to evaluate and adapt: ' + error.message, 500);
        }
    }

    // Helper method to distribute questions
    distributeQuestions(availableQuestions, distribution) {
        const selectedQuestions = [];
        let remainingSlots = 10;

        // First try to fulfill the distribution
        for (const { level, count } of distribution) {
            const levelQuestions = availableQuestions.filter(q => q.bloomLevel === level);
            const available = Math.min(count, levelQuestions.length);

            if (available > 0) {
                const selectedForLevel = levelQuestions
                    .sort(() => Math.random() - 0.5)
                    .slice(0, available);

                selectedQuestions.push(...selectedForLevel);
                remainingSlots -= available;
            }
        }

        // Fill remaining slots with random questions
        if (remainingSlots > 0) {
            const unusedQuestions = availableQuestions.filter(q =>
                !selectedQuestions.some(selected => selected.questionId.equals(q.questionId))
            );

            if (unusedQuestions.length > 0) {
                const additional = unusedQuestions
                    .sort(() => Math.random() - 0.5)
                    .slice(0, remainingSlots);
                selectedQuestions.push(...additional);
            }
        }

        return selectedQuestions;
    }

    async getNextQuestions(instanceId) {
        try {
            // Get instance with populated module data
            const instance = await ModuleInstance.findById(instanceId)
                .populate({
                    path: 'moduleMasterId',
                    select: 'title chapters',
                    populate: {
                        path: 'chapters',
                        populate: {
                            path: 'levels',
                            select: 'bloomLevel questions'
                        }
                    }
                });

            if (!instance) {
                throw new AppError('Module instance not found', 404);
            }

            const currentChapter = instance.moduleMasterId.chapters[instance.currentState.currentChapterIndex];
            if (!currentChapter) {
                throw new AppError('Current chapter not found', 404);
            }

            // Get current question set
            const currentQuestionSet = currentChapter.questionSets.find(qs =>
                qs._id.toString() === instance.currentState.currentQuestionSetId.toString()
            );

            if (!currentQuestionSet) {
                throw new AppError('Question set not found', 404);
            }

            // Get current progress
            const currentProgress = instance.chapterProgress[instance.currentState.currentChapterIndex]
                .questionSets.find(qs => qs.setId.toString() === currentQuestionSet._id.toString());

            if (!currentProgress) {
                throw new AppError('Question set progress not found', 404);
            }

            // Map questions with their details from levels
            const questionsWithDetails = await Promise.all(currentQuestionSet.questionRefs.map(async (ref) => {
                // Find the level containing the question
                const level = currentChapter.levels.find(l => l.bloomLevel === ref.bloomLevel);
                if (!level) {
                    console.warn(`Level ${ref.bloomLevel} not found for question ${ref.questionId}`);
                    return null;
                }

                // Find the question in the level
                const question = level.questions.find(q => q._id.toString() === ref.questionId.toString());
                if (!question) {
                    console.warn(`Question ${ref.questionId} not found in level ${ref.bloomLevel}`);
                    return null;
                }

                // Find progress for this question
                const progress = currentProgress.questions.find(q =>
                    q.questionId.toString() === ref.questionId.toString()
                );

                if (!progress) {
                    console.warn(`Progress not found for question ${ref.questionId}`);
                    return null;
                }

                // Build complete question object
                return {
                    id: progress._id,
                    questionId: ref.questionId,
                    status: progress.status,
                    bloomLevel: ref.bloomLevel,
                    difficultyLevel: question.difficultyLevel,
                    question: question.question,
                    options: question.options,
                    explanation: question.explanation,
                    targetedConcept: question.targetedConcept,
                    learningObjective: question.learningObjective,
                    correctAnswer: question.correctAnswer,
                    userAnswer: progress.userAnswer,
                    isCorrect: progress.isCorrect
                };
            }));

            // Filter out any null values and log warnings if any
            const validQuestions = questionsWithDetails.filter(q => {
                if (q === null) {
                    console.warn('Found invalid question mapping');
                    return false;
                }
                return true;
            });

            // Log diagnostic information
            console.log('Question mapping stats:', {
                totalRefs: currentQuestionSet.questionRefs.length,
                validQuestions: validQuestions.length,
                currentSetId: currentQuestionSet._id.toString(),
                questionSetType: currentQuestionSet.type
            });

            return {
                questions: validQuestions,
                currentLevel: instance.currentState.lastAssessmentLevel,
                progress: {
                    answered: currentProgress.questions.filter(q => q.status === 'completed').length,
                    total: currentProgress.questions.length,
                    remaining: currentProgress.questions.filter(q => q.status === 'pending').length
                },
                setMetadata: {
                    setNumber: currentQuestionSet.setNumber,
                    type: currentQuestionSet.type,
                    adaptationMetadata: currentQuestionSet.adaptationMetadata || {
                        targetedWeakAreas: [],
                        recommendedStudyOrder: []
                    }
                }
            };

        } catch (error) {
            console.error('Error getting questions:', error);
            throw new AppError(`Failed to get questions: ${error.message}`, 500);
        }
    }

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

    async updateInstanceProgress(instance, evaluation, savedQuestionSet = null, adaptiveContent = null) {
        try {
            // Input validation
            if (!instance?._id) {
                throw new AppError('Invalid instance provided', 400);
            }

            if (!evaluation?.score) {
                throw new AppError('Invalid evaluation data', 400);
            }

            // Base update data that's always needed
            const updateData = {
                $set: {
                    'currentState.comprehensionScore': evaluation.score,
                    'currentState.lastAssessmentLevel': evaluation.recommendedLevel,
                    lastAccessedAt: new Date(),
                    [`chapterProgress.${instance.currentState.currentChapterIndex}.comprehensionScore`]: evaluation.score
                }
            };

            // Only proceed with adaptive updates if we have a new question set
            if (savedQuestionSet && savedQuestionSet._id && savedQuestionSet.questionRefs) {
                // Debug logging
                console.log('Processing adaptive update with question set:', {
                    setId: savedQuestionSet._id.toString(),
                    questionCount: savedQuestionSet.questionRefs.length,
                    type: savedQuestionSet.type || 'adaptive'
                });

                // Update current question set ID
                updateData.$set['currentState.currentQuestionSetId'] = savedQuestionSet._id;

                // Create progress tracking for new questions
                const questionSetProgress = {
                    setId: savedQuestionSet._id,
                    setNumber: savedQuestionSet.setNumber || 1,
                    type: savedQuestionSet.type || 'adaptive',
                    questions: savedQuestionSet.questionRefs.map(ref => ({
                        questionId: ref.questionId,
                        status: 'pending',
                        bloomLevel: ref.bloomLevel
                    })),
                    startedAt: new Date()
                };

                // Create adaptive history entry if we have evaluation data
                const adaptiveHistoryEntry = {
                    timestamp: new Date(),
                    previousLevel: instance.currentState.lastAssessmentLevel,
                    newLevel: evaluation.recommendedLevel,
                    assessmentScore: evaluation.score,
                    understandingAnalysis: {
                        weakAreas: evaluation.weakAreas || [],
                        strengths: evaluation.strengths || []
                    },
                    adaptationDetails: {
                        adaptationType: evaluation.score < 50 ? 'level_down' : 'reinforce',
                        focusAreas: evaluation.weakAreas?.map(area => area.topic) || [],
                        recommendedApproach: evaluation.adaptationStrategy?.recommendedApproach || 'Progressive reinforcement',
                        targetBloomLevels: evaluation.adaptationStrategy?.questionDistribution?.map(dist => ({
                            level: dist.bloomLevel,
                            percentage: (dist.count / 10) * 100
                        })) || []
                    },
                    newQuestionSetId: savedQuestionSet._id,
                    newFlashcardIds: adaptiveContent?.newFlashcards?.map(f => f._id) || []
                };

                // Add new entries to update operation
                updateData.$push = {
                    [`chapterProgress.${instance.currentState.currentChapterIndex}.questionSets`]: questionSetProgress,
                    adaptiveHistory: adaptiveHistoryEntry
                };
            }

            // Perform the update
            const updatedInstance = await ModuleInstance.findByIdAndUpdate(
                instance._id,
                updateData,
                {
                    new: true,
                    runValidators: true,
                    populate: {
                        path: 'moduleMasterId',
                        select: 'title chapters'
                    }
                }
            );

            if (!updatedInstance) {
                throw new AppError('Failed to update instance', 500);
            }

            // Verify the update
            const verifyProgress = updatedInstance.chapterProgress[instance.currentState.currentChapterIndex];
            if (!verifyProgress) {
                throw new AppError('Failed to verify instance update', 500);
            }

            return updatedInstance;

        } catch (error) {
            console.error('Error in updateInstanceProgress:', error);
            throw new AppError(`Failed to update instance progress: ${error.message}`, 500);
        }
    }

    async generateQuestions(module, chapter, distribution) {
        try {
            let selectedQuestions = [];

            // Group questions by Bloom's level
            const allQuestionsByLevel = chapter.levels.reduce((acc, level) => {
                if (!acc[level.bloomLevel]) {
                    acc[level.bloomLevel] = [];
                }
                acc[level.bloomLevel].push(...level.questions.map(q => ({
                    questionId: q._id,
                    bloomLevel: level.bloomLevel,
                    targetedConcept: q.targetedConcept
                })));
                return acc;
            }, {});

            // Validate available questions per level and adjust distribution if needed
            const adjustedDistribution = distribution.map(({ level, count }) => {
                const availableCount = (allQuestionsByLevel[level] || []).length;
                if (availableCount < count) {
                    console.warn(`Warning: Level ${level} has only ${availableCount} questions available, requested ${count}`);
                    return {
                        level,
                        count: availableCount,
                        deficit: count - availableCount
                    };
                }
                return { level, count, deficit: 0 };
            });

            // Calculate total deficit and redistribute
            const totalDeficit = adjustedDistribution.reduce((sum, item) => sum + item.deficit, 0);
            if (totalDeficit > 0) {
                // Find levels with excess capacity
                const levelsWithExcess = adjustedDistribution.filter(item => {
                    const available = (allQuestionsByLevel[item.level] || []).length;
                    return available > item.count;
                });

                // Redistribute deficit across levels with capacity
                if (levelsWithExcess.length > 0) {
                    const deficitPerLevel = Math.ceil(totalDeficit / levelsWithExcess.length);
                    levelsWithExcess.forEach(item => {
                        const available = (allQuestionsByLevel[item.level] || []).length;
                        const additional = Math.min(
                            deficitPerLevel,
                            available - item.count,
                            totalDeficit
                        );
                        item.count += additional;
                    });
                }
            }

            // Select questions based on adjusted distribution
            for (const { level, count } of adjustedDistribution) {
                const availableQuestions = allQuestionsByLevel[level] || [];
                if (availableQuestions.length > 0) {
                    const shuffled = [...availableQuestions].sort(() => Math.random() - 0.5);
                    selectedQuestions = [...selectedQuestions, ...shuffled.slice(0, count)];
                }
            }

            // Ensure we have exactly 10 questions
            const finalCount = selectedQuestions.length;
            if (finalCount < 10) {
                // If we don't have enough questions, fill with questions from any level
                const allQuestions = Object.values(allQuestionsByLevel).flat();
                const usedIds = new Set(selectedQuestions.map(q => q.questionId.toString()));
                const remainingQuestions = allQuestions.filter(q => !usedIds.has(q.questionId.toString()));
                const shuffledRemaining = [...remainingQuestions].sort(() => Math.random() - 0.5);
                selectedQuestions = [...selectedQuestions, ...shuffledRemaining.slice(0, 10 - finalCount)];
            } else if (finalCount > 10) {
                // If we have too many questions, trim to exactly 10
                selectedQuestions = selectedQuestions.slice(0, 10);
            }

            return selectedQuestions;
        } catch (error) {
            console.error('Error generating questions:', error);
            throw new AppError('Failed to generate questions: ' + error.message, 500);
        }
    }

    // Modified startModuleInstance method
    async startModuleInstance(moduleId, userId) {
        try {
            const module = await ModuleMaster.findById(moduleId);
            if (!module) throw new AppError('Module not found', 404);

            const initialChapter = module.chapters[0];
            if (!initialChapter) throw new AppError('Chapter not found', 404);

            // Distribution remains the same
            const questionDistribution = [
                { level: 1, count: 2 },
                { level: 2, count: 2 },
                { level: 3, count: 2 },
                { level: 4, count: 2 },
                { level: 5, count: 1 },
                { level: 6, count: 1 }
            ];

            // Generate question references
            const questionRefs = await this.generateQuestions(module, initialChapter, questionDistribution);

            // Create question set with references
            const questionSet = {
                setNumber: 1,
                type: 'initial',
                questionRefs,
                bloomLevelDistribution: questionDistribution.reduce((acc, item) => {
                    acc[`level${item.level}`] = item.count;
                    return acc;
                }, {})
            };

            // Add to chapter and save
            if (!initialChapter.questionSets) {
                initialChapter.questionSets = [];
            }
            initialChapter.questionSets.push(questionSet);
            await module.save();

            // Get the saved question set
            const savedQuestionSet = initialChapter.questionSets[initialChapter.questionSets.length - 1];

            // Create instance with references
            const instance = await ModuleInstance.create({
                moduleMasterId: moduleId,
                userId,
                currentState: {
                    currentChapterIndex: 0,
                    currentLevelIndex: 0,
                    comprehensionScore: 0,
                    lastAssessmentLevel: 1,
                    currentQuestionSetId: savedQuestionSet._id
                },
                chapterProgress: [{
                    chapterIndex: 0,
                    status: 'in_progress',
                    questionSets: [{
                        setId: savedQuestionSet._id,
                        setNumber: 1,
                        type: 'initial',
                        questions: savedQuestionSet.questionRefs.map(ref => ({
                            questionId: ref.questionId,
                            status: 'pending'
                        }))
                    }]
                }]
            });

            return instance;
        } catch (error) {
            console.error('Error starting module instance:', error);
            throw new AppError(`Failed to start module instance: ${error.message}`, 500);
        }
    }

    async evaluatePerformance(instance, currentChapter, currentQuestionSet, submittedAnswers, pdfContent, preferredLanguage) {
        try {
            // Initial validation
            if (!instance || !currentChapter || !currentQuestionSet || !submittedAnswers) {
                throw new AppError('Missing required parameters for evaluation', 400);
            }

            const currentLevel = instance.currentState.lastAssessmentLevel;

            // Get questions from chapter levels using questionRefs
            const questionsByLevel = {};
            currentChapter.levels.forEach(level => {
                questionsByLevel[level.bloomLevel] = level.questions || [];
            });

            // Map to store complete questions indexed by their IDs
            const questionsMap = new Map();

            // Process each question reference from the question set
            currentQuestionSet.questionRefs.forEach(ref => {
                const level = currentChapter.levels.find(l => l.bloomLevel === ref.bloomLevel);
                if (level) {
                    const question = level.questions.find(q => q._id.toString() === ref.questionId.toString());
                    if (question) {
                        questionsMap.set(ref.questionId.toString(), {
                            ...question.toObject(),
                            bloomLevel: ref.bloomLevel,
                            targetedConcept: ref.targetedConcept
                        });
                    }
                }
            });

            console.log('Questions map size:', questionsMap.size);

            // Process submitted answers
            let correctCount = 0;
            const detailedAnswers = [];
            const questionCount = currentQuestionSet.questionRefs.length;

            // Process each submitted answer
            for (const answer of submittedAnswers) {
                if (!answer.questionId) {
                    console.warn('Skipping answer without questionId');
                    continue;
                }

                const answerQuestionId = answer.questionId.toString();
                const question = questionsMap.get(answerQuestionId);

                if (!question) {
                    console.warn(`Question not found for ID: ${answerQuestionId}`);
                    continue;
                }

                const isCorrect = question.correctAnswer === answer.selectedOption;
                if (isCorrect) correctCount++;

                detailedAnswers.push({
                    questionId: answerQuestionId,
                    question: question.question,
                    selectedOption: answer.selectedOption,
                    correctOption: question.correctAnswer,
                    isCorrect: isCorrect,
                    bloomLevel: question.bloomLevel,
                    targetedConcept: question.targetedConcept,
                    learningObjective: question.learningObjective || `Understand ${question.targetedConcept}`
                });
            }

            // Calculate score
            const score = Math.round((correctCount / questionCount) * 100);

            // Analyze performance by Bloom's level
            const performanceByLevel = {};
            detailedAnswers.forEach(answer => {
                if (!performanceByLevel[answer.bloomLevel]) {
                    performanceByLevel[answer.bloomLevel] = {
                        total: 0,
                        correct: 0,
                        concepts: new Set()
                    };
                }
                const levelStats = performanceByLevel[answer.bloomLevel];
                levelStats.total++;
                if (answer.isCorrect) levelStats.correct++;
                levelStats.concepts.add(answer.targetedConcept);
            });

            // Prepare evaluation prompt
            let prompt = EVALUATION_PROMPT
                .replace('{currentLevel}', currentLevel)
                .replace('{questionCount}', questionCount)
                .replace('{correctCount}', correctCount)
                .replace('{answers}', JSON.stringify(detailedAnswers));

            // Add context and language preference
            prompt = `
                Language: ${preferredLanguage}
                Context: Evaluating student performance in ${currentQuestionSet.type} assessment
                Chapter: ${currentChapter.title}
                Current Level: ${currentLevel}
                Score: ${score}%
                ${prompt}
            `;

            // Get AI evaluation for strengths and weaknesses
            const evaluationResult = await this.model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [
                        { text: prompt },
                        {
                            inlineData: {
                                mimeType: "application/pdf",
                                data: pdfContent
                            }
                        }
                    ]
                }]
            });

            // Process AI response
            const aiEvaluation = processAIResponse(evaluationResult.response.text(), 'evaluation');

            // Determine adaptation type and recommended level
            let adaptationType = null;
            let recommendedLevel = currentLevel;

            // Always adapt, but determine how:
            if (score >= 85) {
                if (currentLevel < 6 && aiEvaluation.weakAreas.length === 0) {
                    // High performance, adapt upward
                    adaptationType = 'level_up';
                    recommendedLevel = Math.min(6, currentLevel + 1);
                } else if (currentLevel === 6 && aiEvaluation.weakAreas.length === 0) {
                    // At highest level with perfect performance
                    adaptationType = 'chapter_progress';
                    recommendedLevel = 6;
                } else {
                    // Good performance but has weak areas, lateral adaptation
                    adaptationType = 'reinforce';
                    recommendedLevel = currentLevel;
                }
            } else if (score >= 70) {
                // Decent performance, lateral adaptation
                adaptationType = 'reinforce';
                recommendedLevel = currentLevel;
            } else {
                // Poor performance, adapt downward
                adaptationType = 'remedial';
                if (score < 50 && currentLevel > 1) {
                    recommendedLevel = currentLevel - 1;
                }
            }

            // Calculate question distribution based on performance and adaptationType
            const questionDistribution = this.calculateQuestionDistribution(
                score,
                recommendedLevel,
                performanceByLevel
            );

            // Return complete evaluation results
            return {
                score,
                recommendedLevel,
                needsAdaptation: true, // Always adapt with new questions
                adaptationType,
                weakAreas: aiEvaluation.weakAreas || [],
                strengths: aiEvaluation.strengths || [],
                adaptationStrategy: {
                    focusAreas: aiEvaluation.weakAreas?.map(area => area.topic) || [],
                    recommendedApproach: this.getAdaptationApproach(adaptationType, score),
                    questionDistribution
                },
                performanceAnalysis: {
                    byLevel: Object.entries(performanceByLevel).reduce((acc, [level, stats]) => {
                        acc[level] = {
                            total: stats.total,
                            correct: stats.correct,
                            accuracy: Math.round((stats.correct / stats.total) * 100),
                            concepts: Array.from(stats.concepts)
                        };
                        return acc;
                    }, {}),
                    timestamp: new Date()
                }
            };

        } catch (error) {
            console.error('Error in evaluatePerformance:', error);
            throw new AppError('Failed to evaluate performance: ' + error.message, 500);
        }
    }

    // Helper method to get adaptation approach
    getAdaptationApproach(adaptationType, score) {
        switch (adaptationType) {
            case 'level_up':
                return 'Progress to higher cognitive complexity with new questions';
            case 'chapter_progress':
                return 'Ready for next chapter';
            case 'reinforce':
                return score >= 85
                    ? 'Maintain current level with new challenging questions'
                    : 'Reinforce current level concepts with new questions';
            case 'remedial':
                return 'Review and strengthen fundamental concepts with new questions';
            default:
                return 'Continue with standard progression';
        }
    }

    calculateQuestionDistribution(score, recommendedLevel, performanceByLevel) {
        const distribution = [];
        const totalQuestions = 10;

        // Helper function to ensure level bounds
        const boundLevel = (level) => Math.min(6, Math.max(1, level));

        // Calculate average performance at each level
        const levelPerformances = Object.entries(performanceByLevel).reduce((acc, [level, stats]) => {
            acc[level] = (stats.correct / stats.total) * 100;
            return acc;
        }, {});

        if (score < 50) {
            // Focus on fundamentals with remedial distribution
            const baseLevel = Math.max(1, recommendedLevel - 1);
            distribution.push(
                { bloomLevel: baseLevel, count: 4 },
                { bloomLevel: boundLevel(baseLevel + 1), count: 3 },
                { bloomLevel: boundLevel(baseLevel + 2), count: 2 },
                { bloomLevel: boundLevel(baseLevel + 3), count: 1 }
            );
        } else if (score < 70) {
            // Balanced distribution around recommended level
            const baseLevel = Math.max(1, recommendedLevel - 1);

            // Check performance at current level
            const currentLevelPerformance = levelPerformances[recommendedLevel] || 0;

            if (currentLevelPerformance >= 60) {
                // Student showing competence, lean towards higher levels
                distribution.push(
                    { bloomLevel: baseLevel, count: 2 },
                    { bloomLevel: recommendedLevel, count: 4 },
                    { bloomLevel: boundLevel(recommendedLevel + 1), count: 3 },
                    { bloomLevel: boundLevel(recommendedLevel + 2), count: 1 }
                );
            } else {
                // Student needs more practice at current level
                distribution.push(
                    { bloomLevel: baseLevel, count: 3 },
                    { bloomLevel: recommendedLevel, count: 4 },
                    { bloomLevel: boundLevel(recommendedLevel + 1), count: 2 },
                    { bloomLevel: boundLevel(recommendedLevel + 2), count: 1 }
                );
            }
        } else {
            // High performance - challenge with higher levels
            const maxDemonstrated = Math.max(...Object.keys(levelPerformances).map(Number));
            const nextLevel = boundLevel(recommendedLevel + 1);

            if (score >= 85 && maxDemonstrated >= recommendedLevel) {
                // Excellent performance - push to higher levels
                distribution.push(
                    { bloomLevel: recommendedLevel, count: 2 },
                    { bloomLevel: nextLevel, count: 4 },
                    { bloomLevel: boundLevel(nextLevel + 1), count: 3 },
                    { bloomLevel: boundLevel(nextLevel + 2), count: 1 }
                );
            } else {
                // Good performance - maintain challenge
                distribution.push(
                    { bloomLevel: recommendedLevel, count: 3 },
                    { bloomLevel: nextLevel, count: 3 },
                    { bloomLevel: boundLevel(nextLevel + 1), count: 2 },
                    { bloomLevel: boundLevel(nextLevel + 2), count: 2 }
                );
            }
        }

        // Ensure we don't exceed total questions
        let total = distribution.reduce((sum, item) => sum + item.count, 0);
        while (total > totalQuestions) {
            const highest = distribution[distribution.length - 1];
            if (highest.count > 1) {
                highest.count--;
                total--;
            } else {
                distribution.pop();
                total--;
            }
        }

        return distribution;
    }

    async generateAdaptiveContent(instance, currentChapter, evaluation, pdfContent, preferredLanguage) {
        try {
            // Input validation
            if (!instance || !currentChapter || !evaluation) {
                throw new AppError('Missing required parameters for adaptive content generation', 400);
            }

            // Calculate adaptation context
            const adaptiveContext = {
                studentInfo: {
                    currentLevel: instance.currentState.lastAssessmentLevel,
                    currentScore: evaluation.score,
                    weakAreas: evaluation.weakAreas || []
                },
                adaptationNeeds: {
                    targetLevel: evaluation.recommendedLevel,
                    questionDistribution: evaluation.adaptationStrategy?.questionDistribution || []
                }
            };

            // Helper function to calculate difficulty level
            const calculateDifficultyLevel = (bloomLevel, performance) => {
                if (performance < 50) return Math.max(1, Math.ceil(bloomLevel * 0.6));
                if (performance < 70) return Math.min(5, Math.ceil(bloomLevel * 0.8));
                return Math.min(5, Math.ceil(bloomLevel * 1.0));
            };

            // Prepare AI prompt
            let prompt = ADAPTIVE_CONTENT_PROMPT
                .replace('{targetLevel}', adaptiveContext.adaptationNeeds.targetLevel)
                .replace('{focusAreas}', JSON.stringify(adaptiveContext.studentInfo.weakAreas))
                .replace('{weakConcepts}', JSON.stringify(evaluation.weakAreas))
                .replace('{chapterTitle}', currentChapter.title);

            prompt = `
                Language: ${preferredLanguage}
                Context: Generating adaptive content for student
                Current Level: ${adaptiveContext.studentInfo.currentLevel}
                Score: ${adaptiveContext.studentInfo.currentScore}%
                ${prompt}
            `;

            // Get AI response
            const adaptiveResult = await this.model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [
                        { text: prompt },
                        {
                            inlineData: {
                                mimeType: "application/pdf",
                                data: pdfContent
                            }
                        }
                    ]
                }]
            });

            // Process AI response
            const adaptiveContent = processAIResponse(adaptiveResult.response.text(), 'adaptiveContent');

            // Prepare new questions with proper levels
            const newQuestionsByLevel = {};
            adaptiveContent.questions.forEach(q => {
                const bloomLevel = q.bloomLevel || adaptiveContext.adaptationNeeds.targetLevel;

                if (!newQuestionsByLevel[bloomLevel]) {
                    newQuestionsByLevel[bloomLevel] = [];
                }

                const newQuestion = {
                    _id: new mongoose.Types.ObjectId(),
                    question: q.question,
                    options: q.options,
                    correctAnswer: q.correctAnswer,
                    explanation: q.explanation,
                    bloomLevel: bloomLevel,
                    difficultyLevel: q.difficultyLevel || calculateDifficultyLevel(
                        bloomLevel,
                        adaptiveContext.studentInfo.currentScore
                    ),
                    learningObjective: q.learningObjective || `Master ${q.targetedConcept}`,
                    targetedConcept: q.targetedConcept,
                    metadata: {
                        timeToAnswer: 120,
                        averageScore: 0,
                        lastUpdated: new Date()
                    }
                };

                // Validate question
                if (!newQuestion.question || !Array.isArray(newQuestion.options) ||
                    newQuestion.options.length !== 4 || typeof newQuestion.correctAnswer !== 'number') {
                    console.warn('Skipping invalid question:', newQuestion.question);
                    return;
                }

                newQuestionsByLevel[bloomLevel].push(newQuestion);
            });

            // Get existing chapter for atomic update
            const module = await ModuleMaster.findOne(
                { _id: instance.moduleMasterId._id, 'chapters._id': currentChapter._id },
                { 'chapters.$': 1 }
            );

            if (!module || !module.chapters[0]) {
                throw new AppError('Chapter not found for update', 404);
            }

            const existingChapter = module.chapters[0];

            // Prepare update operations for each bloom level
            const updateOperations = [];
            for (const [bloomLevel, questions] of Object.entries(newQuestionsByLevel)) {
                const levelNumber = parseInt(bloomLevel);
                const existingLevelIndex = existingChapter.levels.findIndex(l => l.bloomLevel === levelNumber);

                if (existingLevelIndex !== -1) {
                    // Add questions to existing level
                    updateOperations.push({
                        updateOne: {
                            filter: {
                                _id: instance.moduleMasterId._id,
                                'chapters._id': currentChapter._id,
                                'chapters.levels.bloomLevel': levelNumber
                            },
                            update: {
                                $push: {
                                    'chapters.$[chapterElem].levels.$[levelElem].questions': {
                                        $each: questions
                                    }
                                }
                            },
                            arrayFilters: [
                                { 'chapterElem._id': currentChapter._id },
                                { 'levelElem.bloomLevel': levelNumber }
                            ]
                        }
                    });
                } else {
                    // Create new level
                    updateOperations.push({
                        updateOne: {
                            filter: {
                                _id: instance.moduleMasterId._id,
                                'chapters._id': currentChapter._id
                            },
                            update: {
                                $push: {
                                    'chapters.$.levels': {
                                        bloomLevel: levelNumber,
                                        questions: questions
                                    }
                                }
                            }
                        }
                    });
                }
            }

            // Execute all updates atomically
            if (updateOperations.length > 0) {
                const updateResult = await ModuleMaster.bulkWrite(updateOperations, { ordered: false });
                console.log('Update result:', updateResult);
            }

            // Create flashcards
            const flashcards = adaptiveContent.newFlashcards.map(f => ({
                _id: new mongoose.Types.ObjectId(),
                content: f.content,
                comprehensionLevel: f.comprehensionLevel || adaptiveContext.adaptationNeeds.targetLevel,
                flashcardFront: f.flashcardFront,
                flashcardBack: f.flashcardBack,
                relatedConcepts: f.relatedConcepts || [],
                practicePrompt: f.practicePrompt || '',
                adaptiveFor: {
                    weakArea: evaluation.weakAreas.find(w =>
                        f.content.toLowerCase().includes(w.topic.toLowerCase())
                    )?.topic || 'General reinforcement',
                    bloomLevel: f.comprehensionLevel || adaptiveContext.adaptationNeeds.targetLevel,
                    generatedAt: new Date()
                }
            }));

            // Add flashcards using atomic operation
            await ModuleMaster.updateOne(
                {
                    _id: instance.moduleMasterId._id,
                    'chapters._id': currentChapter._id
                },
                {
                    $push: {
                        'chapters.$.summaries': {
                            $each: flashcards
                        }
                    }
                }
            );

            // Create question references for the new question set
            const questionRefs = [];
            Object.entries(newQuestionsByLevel).forEach(([bloomLevel, questions]) => {
                questions.forEach(question => {
                    questionRefs.push({
                        questionId: question._id,
                        bloomLevel: parseInt(bloomLevel),
                        targetedConcept: question.targetedConcept
                    });
                });
            });

            return {
                questionRefs,
                newFlashcards: flashcards,
                adaptationMetadata: {
                    targetedWeakAreas: evaluation.weakAreas.map(area => area.topic),
                    learningProgression: adaptiveContent.adaptationMetadata?.learningProgression || 'Progressive concept reinforcement',
                    recommendedStudyOrder: evaluation.weakAreas.map(w => w.topic),
                    questionDistribution: evaluation.adaptationStrategy.questionDistribution
                }
            };

        } catch (error) {
            console.error('Error in generateAdaptiveContent:', error);
            throw new AppError(`Failed to generate adaptive content: ${error.message}`, 500);
        }
    }

    // Add this helper method to ModuleService class
    async getCurrentQuestionSet(instance) {
        try {
            if (!instance?.currentState?.currentQuestionSetId) {
                throw new AppError('No current question set ID found in instance', 400);
            }

            const currentChapter = instance.moduleMasterId.chapters[instance.currentState.currentChapterIndex];
            if (!currentChapter) {
                throw new AppError('Current chapter not found', 404);
            }

            // Convert to string for comparison
            const currentSetId = instance.currentState.currentQuestionSetId.toString();

            const questionSet = currentChapter.questionSets.find(qs =>
                qs._id.toString() === currentSetId
            );

            if (!questionSet) {
                throw new AppError('Question set not found', 404);
            }

            return questionSet;
        } catch (error) {
            console.error('Error getting current question set:', error);
            throw new AppError(`Failed to get current question set: ${error.message}`, error.statusCode || 500);
        }
    }

    calculateRecommendedLevel(score, currentLevel, aiRecommendedLevel, performanceByLevel) {
        // Use AI recommendation if valid
        if (aiRecommendedLevel >= 1 && aiRecommendedLevel <= 6) {
            return aiRecommendedLevel;
        }

        // Calculate performance at current level
        const currentLevelStats = performanceByLevel[currentLevel];
        const currentLevelAccuracy = currentLevelStats
            ? (currentLevelStats.correct / currentLevelStats.total) * 100
            : 0;

        // Determine level change based on performance
        if (score >= 85 && currentLevelAccuracy >= 80) {
            return Math.min(currentLevel + 1, 6);
        } else if (score < 50 || currentLevelAccuracy < 40) {
            return Math.max(currentLevel - 1, 1);
        }

        return currentLevel;
    }
}

module.exports = new ModuleService();