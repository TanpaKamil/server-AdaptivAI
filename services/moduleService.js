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
            console.log('\n=== Starting Evaluation and Adaptation ===');
            console.log('Instance ID:', instanceId);
            console.log('Answers received:', answers.length);

            // Input validation
            if (!instanceId || !answers || !Array.isArray(answers)) {
                console.error('Invalid input parameters:', {
                    hasInstanceId: !!instanceId,
                    hasAnswers: !!answers,
                    isArray: Array.isArray(answers)
                });
                throw new AppError('Invalid input parameters', 400);
            }

            // Load and validate instance
            console.log('\nLoading instance data...');
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
                console.error('Invalid instance:', {
                    hasInstance: !!instance,
                    hasCurrentState: !!(instance?.currentState)
                });
                throw new AppError('Invalid instance or state', 404);
            }

            // Get current chapter
            const currentChapter = instance.moduleMasterId.chapters[instance.currentState.currentChapterIndex];
            if (!currentChapter) {
                console.error('Current chapter not found:', {
                    chapterIndex: instance.currentState.currentChapterIndex
                });
                throw new AppError('Current chapter not found', 404);
            }

            // Get current question set
            console.log('\nLocating current question set...');
            const currentQuestionSet = currentChapter.questionSets.find(qs =>
                qs._id.toString() === instance.currentState.currentQuestionSetId.toString()
            );
            if (!currentQuestionSet) {
                console.error('Question set not found:', {
                    questionSetId: instance.currentState.currentQuestionSetId
                });
                throw new AppError('Question set not found', 404);
            }

            console.log('Current state:', {
                chapterTitle: currentChapter.title,
                chapterIndex: instance.currentState.currentChapterIndex,
                currentLevel: instance.currentState.lastAssessmentLevel,
                questionSetType: currentQuestionSet.type,
                questionSetNumber: currentQuestionSet.setNumber
            });

            // Get PDF content for AI evaluation
            console.log('\nFetching PDF content for AI evaluation...');
            const pdfContent = await this.getPDFContent(instance.moduleMasterId.pdfUrl);
            console.log('PDF content loaded successfully');

            console.log('\nUpdating answer progress...');
            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    // Log answers being processed
                    const answerUpdates = [];

                    for (const answer of answers) {
                        const questionRef = currentQuestionSet.questionRefs.find(
                            ref => ref.questionId.toString() === answer.questionId.toString()
                        );

                        if (!questionRef) {
                            console.warn('Question ref not found:', answer.questionId);
                            continue;
                        }

                        // Find the question in the correct level
                        const level = currentChapter.levels.find(l => l.bloomLevel === questionRef.bloomLevel);
                        const question = level?.questions.find(q => q._id.toString() === answer.questionId.toString());

                        if (!question) {
                            console.warn('Question not found:', answer.questionId);
                            continue;
                        }

                        const isCorrect = question.correctAnswer === answer.selectedOption;
                        answerUpdates.push({
                            questionId: answer.questionId,
                            isCorrect,
                            selectedOption: answer.selectedOption
                        });

                        // Update individual question statuses
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

                    console.log('Processing answer updates:', {
                        totalAnswers: answers.length,
                        validUpdates: answerUpdates.length,
                        correctAnswers: answerUpdates.filter(a => a.isCorrect).length
                    });

                    // Update question set status if all questions are answered
                    const allQuestionsAnswered = answers.length === currentQuestionSet.questionRefs.length;
                    if (allQuestionsAnswered) {
                        console.log('All questions answered - updating set status to completed');
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
            console.log('\nGetting performance evaluation...');
            const evaluation = await this.evaluatePerformance(
                instance,
                currentChapter,
                currentQuestionSet,
                answers,
                pdfContent,
                preferredLanguage
            );

            console.log('\nEvaluation results:', {
                score: evaluation.score,
                recommendedLevel: evaluation.recommendedLevel,
                adaptationType: evaluation.adaptationType,
                currentChapterIndex: instance.currentState.currentChapterIndex,
                totalChapters: instance.moduleMasterId.chapters.length
            });

            // Check for chapter progression
            const isLastChapter = instance.currentState.currentChapterIndex === instance.moduleMasterId.chapters.length - 1;
            const isReadyForNextChapter = evaluation.adaptationType === 'chapter_progress' && !isLastChapter;

            console.log('\nProgression status:', {
                isLastChapter,
                isReadyForNextChapter,
                currentChapter: instance.currentState.currentChapterIndex,
                totalChapters: instance.moduleMasterId.chapters.length
            });

            if (isReadyForNextChapter) {
                if (isLastChapter) {
                    console.log('\n🎉 Module completion detected!');
                    // Mark current chapter as completed
                    await ModuleInstance.updateOne(
                        { _id: instanceId },
                        {
                            $set: {
                                [`chapterProgress.${instance.currentState.currentChapterIndex}.status`]: 'completed',
                                status: 'completed',
                                completedAt: new Date()
                            }
                        }
                    );

                    return {
                        evaluation: {
                            ...evaluation,
                            moduleCompleted: true,
                            finalScore: instance.currentState.comprehensionScore,
                            completionDate: new Date(),
                            summary: {
                                totalChapters: instance.moduleMasterId.chapters.length,
                                averageScore: evaluation.score,
                                timeSpent: new Date() - instance.startedAt,
                                masteredConcepts: evaluation.strengths.map(s => s.topic),
                                finalLevel: evaluation.recommendedLevel
                            }
                        }
                    };
                } else
                    console.log('\n🎯 Initiating chapter progression');
                const nextChapterIndex = instance.currentState.currentChapterIndex + 1;
                const nextChapter = instance.moduleMasterId.chapters[nextChapterIndex];

                console.log('Next chapter:', {
                    index: nextChapterIndex,
                    title: nextChapter.title
                });

                try {
                    await this.ensureChapterContent(
                        instance.moduleMasterId._id,
                        nextChapter._id,
                        instance.userId,
                        preferredLanguage
                    );

                    // Mark current chapter as completed
                    await ModuleInstance.updateOne(
                        { _id: instanceId },
                        {
                            $set: {
                                [`chapterProgress.${instance.currentState.currentChapterIndex}.status`]: 'completed'
                            }
                        }
                    );

                    console.log('✨ Current chapter marked as completed');

                    // Create new chapter progress with initial questions
                    return await this.handleChapterProgression(
                        instance,
                        nextChapter,
                        nextChapterIndex,
                        preferredLanguage
                    );
                } catch (error) {
                    console.error('\n❌ Chapter progression failed:', error);
                    throw new AppError('Failed to progress to next chapter: ' + error.message, 500);
                }
            } else {
                // Handle adaptive content in current chapter
                console.log('\n🔄 Generating adaptive content for current chapter');
                return await this.handleAdaptiveContent(
                    instance,
                    currentChapter,
                    evaluation,
                    pdfContent,
                    preferredLanguage
                );
            }
        } catch (error) {
            console.error('\n❌ Error in evaluateAndAdapt:', error);
            throw new AppError('Failed to evaluate and adapt: ' + error.message, 500);
        }
    }

    // Helper method to handle adaptive content generation and updates
    async handleAdaptiveContent(instance, currentChapter, evaluation, pdfContent, preferredLanguage) {
        try {
            console.log('\nGenerating adaptive content');
            const adaptiveContent = await this.generateAdaptiveContent(
                instance,
                currentChapter,
                evaluation,
                pdfContent,
                preferredLanguage
            );

            // Create new question set
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

            // Validate question set
            if (!newQuestionSet.questionRefs || newQuestionSet.questionRefs.length === 0) {
                throw new AppError('Generated question set is empty', 500);
            }

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

            // Create evaluation object for instance update
            const progressEvaluation = {
                score: evaluation.score,
                recommendedLevel: evaluation.recommendedLevel,
                weakAreas: evaluation.weakAreas || [],
                strengths: evaluation.strengths || [],
                adaptationType: evaluation.adaptationType,
                adaptationStrategy: evaluation.adaptationStrategy
            };

            // Update instance progress
            await this.updateInstanceProgress(
                instance,
                progressEvaluation,
                newQuestionSet,
                adaptiveContent
            );

            return {
                evaluation: {
                    score: evaluation.score,
                    recommendedLevel: evaluation.recommendedLevel,
                    needsAdaptation: evaluation.needsAdaptation,
                    weakAreas: evaluation.weakAreas || [],
                    strengths: evaluation.strengths || []
                },
                adaptiveContent: {
                    setId: newQuestionSet._id,
                    type: 'adaptive',
                    questions: newQuestionSet.questionRefs,
                    flashcardIds: adaptiveContent.newFlashcards.map(f => f._id)
                }
            };

        } catch (error) {
            console.error('\nError in handleAdaptiveContent:', error);
            throw new AppError(`Failed to handle adaptive content: ${error.message}`, 500);
        }
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
            console.log('\n=== Updating Instance Progress ===');

            // Validate instance
            if (!instance?._id) {
                console.error('Invalid instance:', { hasId: !!instance?._id });
                throw new AppError('Invalid instance provided', 400);
            }

            // Validate evaluation data
            if (typeof evaluation?.score !== 'number') {
                console.error('Invalid evaluation data:', {
                    hasEvaluation: !!evaluation,
                    score: evaluation?.score,
                    scoreType: typeof evaluation?.score
                });
                throw new AppError('Invalid evaluation data: score must be a number', 400);
            }

            console.log('Update parameters:', {
                instanceId: instance._id,
                score: evaluation.score,
                recommendedLevel: evaluation.recommendedLevel,
                hasQuestionSet: !!savedQuestionSet,
                hasAdaptiveContent: !!adaptiveContent
            });

            // Base update data that's always needed
            const updateData = {
                $set: {
                    'currentState.comprehensionScore': evaluation.score,
                    'currentState.lastAssessmentLevel': evaluation.recommendedLevel || instance.currentState.lastAssessmentLevel,
                    lastAccessedAt: new Date(),
                    [`chapterProgress.${instance.currentState.currentChapterIndex}.comprehensionScore`]: evaluation.score
                }
            };

            // Only proceed with adaptive updates if we have a new question set
            if (savedQuestionSet?._id && Array.isArray(savedQuestionSet.questionRefs)) {
                console.log('\nProcessing adaptive update with question set:', {
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

                // Create adaptive history entry
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

                console.log('Question set progress created:', {
                    setId: questionSetProgress.setId,
                    questionCount: questionSetProgress.questions.length,
                    type: questionSetProgress.type
                });
            }

            // Perform the update
            console.log('\nExecuting instance update...');
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

            console.log('\n✅ Instance progress updated successfully');
            return updatedInstance;

        } catch (error) {
            console.error('\n❌ Error in updateInstanceProgress:', error);
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
            console.log('\n=== Starting Performance Evaluation ===');
            console.log('Instance ID:', instance._id);
            console.log('Current Chapter:', currentChapter.title);
            console.log('Current Level:', instance.currentState.lastAssessmentLevel);

            // Initial validation
            if (!instance || !currentChapter || !currentQuestionSet || !submittedAnswers) {
                console.error('Missing required parameters:', {
                    hasInstance: !!instance,
                    hasChapter: !!currentChapter,
                    hasQuestionSet: !!currentQuestionSet,
                    hasAnswers: !!submittedAnswers
                });
                throw new AppError('Missing required parameters for evaluation', 400);
            }

            const currentLevel = instance.currentState.lastAssessmentLevel;
            console.log('\nCurrent Assessment State:', {
                chapterIndex: instance.currentState.currentChapterIndex,
                currentLevel,
                questionSetType: currentQuestionSet.type
            });

            // Create a map of questions for easy lookup
            const questionsMap = new Map();
            currentQuestionSet.questionRefs.forEach(ref => {
                const level = currentChapter.levels.find(l => l.bloomLevel === ref.bloomLevel);
                if (level) {
                    const question = level.questions.find(q => q._id.toString() === ref.questionId.toString());
                    if (question) {
                        questionsMap.set(ref.questionId.toString(), {
                            ...question.toObject(),
                            bloomLevel: ref.bloomLevel
                        });
                    }
                }
            });

            console.log('Questions loaded:', questionsMap.size);

            // Process answers and track performance
            let correctCount = 0;
            const detailedAnswers = [];
            const questionCount = submittedAnswers.length;

            // Track performance by concept and Bloom's level
            const conceptPerformance = new Map();
            const levelPerformance = new Map();

            // Process each answer
            submittedAnswers.forEach(answer => {
                const question = questionsMap.get(answer.questionId.toString());
                if (!question) {
                    console.warn('Question not found for answer:', answer.questionId);
                    return;
                }

                const isCorrect = question.correctAnswer === answer.selectedOption;
                if (isCorrect) correctCount++;

                // Track detailed answer
                detailedAnswers.push({
                    questionId: answer.questionId,
                    isCorrect: isCorrect,
                    bloomLevel: question.bloomLevel,
                    userAnswer: answer.selectedOption,
                    correctAnswer: question.correctAnswer,
                    concept: question.targetedConcept
                });

                // Track concept performance
                if (!conceptPerformance.has(question.targetedConcept)) {
                    conceptPerformance.set(question.targetedConcept, {
                        correct: 0,
                        total: 0,
                        bloomLevels: new Set(),
                        questions: []
                    });
                }
                const conceptStats = conceptPerformance.get(question.targetedConcept);
                conceptStats.total++;
                if (isCorrect) conceptStats.correct++;
                conceptStats.bloomLevels.add(question.bloomLevel);
                conceptStats.questions.push({
                    isCorrect,
                    bloomLevel: question.bloomLevel
                });

                // Track Bloom's level performance
                if (!levelPerformance.has(question.bloomLevel)) {
                    levelPerformance.set(question.bloomLevel, {
                        correct: 0,
                        total: 0,
                        concepts: new Set()
                    });
                }
                const levelStats = levelPerformance.get(question.bloomLevel);
                levelStats.total++;
                if (isCorrect) levelStats.correct++;
                levelStats.concepts.add(question.targetedConcept);
            });

            // Calculate overall score
            const score = Math.round((correctCount / questionCount) * 100);
            console.log('\nPerformance Results:', {
                totalQuestions: questionCount,
                correctAnswers: correctCount,
                score: score + '%'
            });

            // Analyze strengths and weaknesses
            const strengths = [];
            const weakAreas = [];

            conceptPerformance.forEach((stats, concept) => {
                const conceptScore = (stats.correct / stats.total) * 100;
                const bloomLevels = Array.from(stats.bloomLevels);
                const conceptPerformanceDetails = {
                    accuracy: conceptScore.toFixed(1) + '%',
                    correctAnswers: stats.correct,
                    totalQuestions: stats.total,
                    bloomLevels: Array.from(bloomLevels).sort()
                };

                if (conceptScore >= 80) {
                    strengths.push({
                        topic: concept,
                        bloomLevel: Math.max(...bloomLevels),
                        demonstratedSkills: [
                            `Mastered concept with ${conceptScore.toFixed(1)}% accuracy`,
                            `Successfully answered ${stats.correct} out of ${stats.total} questions`,
                            `Demonstrated competency up to Bloom's level ${Math.max(...bloomLevels)}`
                        ]
                    });
                }
                if (conceptScore < 70) {
                    weakAreas.push({
                        topic: concept,
                        bloomLevel: Math.min(...bloomLevels),
                        detectedIssues: [
                            `Performance at ${conceptScore.toFixed(1)}%`,
                            `Missed ${stats.total - stats.correct} out of ${stats.total} questions`
                        ],
                        recommendedFocus: `Focus on strengthening understanding of ${concept} fundamentals and practice application`
                    });
                }

                console.log(`Concept Performance - ${concept}:`, conceptPerformanceDetails);
            });

            // Simple progression check: Level 6 and score >= 80
            const isReadyForProgression = currentLevel === 6 && score >= 80;
            console.log('\nProgression Check:', {
                isAtLevel6: currentLevel === 6,
                hasRequiredScore: score >= 80,
                isReadyForProgression
            });

            // Determine recommended level based on score
            let recommendedLevel = currentLevel;
            let adaptationType = 'reinforce';

            if (isReadyForProgression) {
                adaptationType = 'chapter_progress';
                console.log('✨ Ready for Chapter Progression!');
            } else if (score < 50) {
                recommendedLevel = Math.max(1, currentLevel - 1);
                adaptationType = 'level_down';
                console.log('⬇️ Recommending Level Down');
            } else if (score >= 80 && currentLevel < 6) {
                recommendedLevel = Math.min(6, currentLevel + 1);
                adaptationType = 'level_up';
                console.log('⬆️ Recommending Level Up');
            } else {
                console.log('↔️ Maintaining Current Level');
            }

            // Generate question distribution based on 20-60-20 rule
            let questionDistribution = [];
            if (!isReadyForProgression) {
                const lowerLevel = Math.max(1, recommendedLevel - 1);
                const higherLevel = Math.min(6, recommendedLevel + 1);

                questionDistribution = [
                    { bloomLevel: lowerLevel, count: 2, topics: ["Foundational concepts"], reasoning: "20% easier content" },
                    { bloomLevel: recommendedLevel, count: 6, topics: ["Current level concepts"], reasoning: "60% current level" },
                    { bloomLevel: higherLevel, count: 2, topics: ["Advanced concepts"], reasoning: "20% challenging content" }
                ];
            } else {
                // Initial distribution for next chapter
                questionDistribution = [
                    { bloomLevel: 1, count: 2, topics: ["Basic concepts"], reasoning: "Fundamental knowledge" },
                    { bloomLevel: 2, count: 2, topics: ["Understanding"], reasoning: "Comprehension" },
                    { bloomLevel: 3, count: 2, topics: ["Application"], reasoning: "Practical use" },
                    { bloomLevel: 4, count: 2, topics: ["Analysis"], reasoning: "Breaking down concepts" },
                    { bloomLevel: 5, count: 1, topics: ["Evaluation"], reasoning: "Critical thinking" },
                    { bloomLevel: 6, count: 1, topics: ["Creation"], reasoning: "Synthesis" }
                ];
            }

            console.log('\nQuestion Distribution:', {
                type: isReadyForProgression ? 'Next Chapter Initial' : '20-60-20',
                distribution: questionDistribution.map(d =>
                    `Level ${d.bloomLevel}: ${d.count} questions`
                )
            });

            // Build evaluation response
            const evaluationResult = {
                score,
                recommendedLevel,
                needsAdaptation: !isReadyForProgression,
                adaptationType,
                weakAreas,
                strengths,
                adaptationStrategy: {
                    focusAreas: weakAreas.map(w => w.topic),
                    recommendedApproach: isReadyForProgression
                        ? 'Progress to next chapter'
                        : 'Continue with current level focusing on identified weak areas',
                    questionDistribution
                },
                performanceAnalysis: {
                    totalQuestions: questionCount,
                    correctAnswers: correctCount,
                    accuracy: score,
                    detailedAnswers
                },
                metadata: {
                    evaluationVersion: '2.0',
                    timestamp: new Date()
                }
            };

            console.log('\n=== Evaluation Complete ===');
            console.log('Final Recommendation:', {
                adaptationType,
                recommendedLevel,
                needsAdaptation: !isReadyForProgression,
                strengthsIdentified: strengths.length,
                weakAreasIdentified: weakAreas.length
            });

            return evaluationResult;

        } catch (error) {
            console.error('\n❌ Error in evaluatePerformance:', error);
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
            console.log('\n=== Starting Adaptive Content Generation ===');
            console.log('Instance ID:', instance._id);
            console.log('Chapter:', currentChapter.title);

            // Input validation
            if (!instance || !currentChapter || !evaluation) {
                console.error('Missing required parameters:', {
                    hasInstance: !!instance,
                    hasChapter: !!currentChapter,
                    hasEvaluation: !!evaluation
                });
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

            console.log('\nAdaptation Context:', {
                currentLevel: adaptiveContext.studentInfo.currentLevel,
                targetLevel: adaptiveContext.adaptationNeeds.targetLevel,
                score: adaptiveContext.studentInfo.currentScore,
                distributionCount: adaptiveContext.adaptationNeeds.questionDistribution.length
            });

            // Helper function to calculate difficulty level
            const calculateDifficultyLevel = (bloomLevel, performance) => {
                if (performance < 50) return Math.max(1, Math.ceil(bloomLevel * 0.6));
                if (performance < 70) return Math.min(5, Math.ceil(bloomLevel * 0.8));
                return Math.min(5, Math.ceil(bloomLevel * 1.0));
            };

            // Prepare AI prompt
            console.log('\n🤖 Preparing AI prompt...');
            let prompt = ADAPTIVE_CONTENT_PROMPT
                .replace('{targetLevel}', adaptiveContext.adaptationNeeds.targetLevel)
                .replace('{focusAreas}', JSON.stringify(adaptiveContext.studentInfo.weakAreas))
                .replace('{weakConcepts}', JSON.stringify(evaluation.weakAreas))
                .replace('{chapterTitle}', currentChapter.title)
                .replace('{questionDistribution}', JSON.stringify(adaptiveContext.adaptationNeeds.questionDistribution));

            prompt = `
                Language: ${preferredLanguage}
                Context: Generating adaptive content for student
                Current Level: ${adaptiveContext.studentInfo.currentLevel}
                Score: ${adaptiveContext.studentInfo.currentScore}%
                ${prompt}
            `;

            console.log('Prompt prepared with distribution:',
                adaptiveContext.adaptationNeeds.questionDistribution.map(d =>
                    `Level ${d.bloomLevel}: ${d.count} questions`
                )
            );

            // Get AI response
            console.log('\n📡 Sending request to AI...');
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

            console.log('✅ AI response received');

            // Process AI response
            console.log('\n🔍 Processing AI response...');
            const adaptiveContent = processAIResponse(adaptiveResult.response.text(), 'adaptiveContent');

            console.log('Content generated:', {
                questions: adaptiveContent.questions.length,
                flashcards: adaptiveContent.newFlashcards.length
            });

            // Prepare new questions with proper levels
            console.log('\n📝 Processing questions by level...');
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
                    console.warn('⚠️ Skipping invalid question:', {
                        hasQuestion: !!newQuestion.question,
                        hasOptions: Array.isArray(newQuestion.options),
                        optionCount: newQuestion.options?.length,
                        hasCorrectAnswer: typeof newQuestion.correctAnswer === 'number'
                    });
                    return;
                }

                newQuestionsByLevel[bloomLevel].push(newQuestion);
            });

            console.log('\nQuestion distribution achieved:', Object.entries(newQuestionsByLevel)
                .map(([level, questions]) => `Level ${level}: ${questions.length} questions`)
            );

            // Update database
            console.log('\n💾 Updating database with new content...');

            // Get existing chapter for atomic update
            const module = await ModuleMaster.findOne(
                { _id: instance.moduleMasterId._id, 'chapters._id': currentChapter._id },
                { 'chapters.$': 1 }
            );

            if (!module || !module.chapters[0]) {
                throw new AppError('Chapter not found for update', 404);
            }

            const existingChapter = module.chapters[0];

            // Prepare update operations
            console.log('\nPreparing database updates...');
            const updateOperations = [];
            for (const [bloomLevel, questions] of Object.entries(newQuestionsByLevel)) {
                const levelNumber = parseInt(bloomLevel);
                const existingLevelIndex = existingChapter.levels.findIndex(l => l.bloomLevel === levelNumber);

                if (existingLevelIndex !== -1) {
                    console.log(`Adding ${questions.length} questions to existing level ${levelNumber}`);
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
                    console.log(`Creating new level ${levelNumber} with ${questions.length} questions`);
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

            // Execute database updates
            if (updateOperations.length > 0) {
                console.log(`Executing ${updateOperations.length} database operations...`);
                const updateResult = await ModuleMaster.bulkWrite(updateOperations, { ordered: false });
                console.log('Update result:', updateResult);
            }

            // Create flashcards
            console.log('\n📑 Processing flashcards...');
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

            console.log(`Generated ${flashcards.length} flashcards`);

            // Add flashcards to database
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

            // Create question references
            console.log('\n🔗 Creating question references...');
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

            console.log('\n=== Adaptive Content Generation Complete ===');
            console.log('Final content generated:', {
                questions: questionRefs.length,
                flashcards: flashcards.length,
                levelsUpdated: Object.keys(newQuestionsByLevel).length
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
            console.error('\n❌ Error in generateAdaptiveContent:', error);
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

    async isChapterContentGenerated(chapter) {
        if (!chapter) return false;

        // Check if summaries exist and are not empty
        const hasSummaries = Array.isArray(chapter.summaries) && chapter.summaries.length > 0;

        // Check if levels exist and contain questions
        const hasLevels = Array.isArray(chapter.levels) && chapter.levels.length > 0;

        // Check if all Bloom's levels (1-6) have questions
        const hasAllBloomLevels = chapter.levels?.reduce((acc, level) => {
            return acc && Array.isArray(level.questions) && level.questions.length > 0;
        }, hasLevels);

        return hasSummaries && hasAllBloomLevels;
    }

    // Add this method to handle chapter content generation
    async ensureChapterContent(moduleId, chapterId, userId, preferredLanguage) {
        try {
            const module = await ModuleMaster.findById(moduleId);
            if (!module) throw new AppError('Module not found', 404);

            const chapter = module.chapters.id(chapterId);
            if (!chapter) throw new AppError('Chapter not found', 404);

            // Check if content needs to be generated
            const isContentGenerated = await this.isChapterContentGenerated(chapter);

            if (!isContentGenerated) {
                console.log(`Generating content for chapter ${chapterId}`);
                await this.generateChapterContent(moduleId, chapterId, userId, preferredLanguage);

                // Verify content generation was successful
                const updatedModule = await ModuleMaster.findById(moduleId);
                const updatedChapter = updatedModule.chapters.id(chapterId);

                if (!await this.isChapterContentGenerated(updatedChapter)) {
                    throw new AppError('Failed to generate chapter content', 500);
                }
            }

            return true;
        } catch (error) {
            console.error('Error ensuring chapter content:', error);
            throw new AppError(`Failed to ensure chapter content: ${error.message}`, 500);
        }
    }

    async handleChapterProgression(instance, nextChapter, nextChapterIndex, preferredLanguage) {
        try {
            console.log('\n=== Starting Chapter Progression ===');
            console.log('Instance ID:', instance._id);
            console.log('Current Status:', {
                fromChapter: instance.currentState.currentChapterIndex,
                toChapter: nextChapterIndex,
                nextChapterTitle: nextChapter.title
            });

            // First, ensure chapter content is generated and get fresh chapter data
            console.log('\n🔄 Ensuring chapter content is generated...');
            await this.ensureChapterContent(
                instance.moduleMasterId._id,
                nextChapter._id,
                instance.userId,
                preferredLanguage
            );

            // Reload the module to get fresh chapter data
            console.log('\n📥 Reloading chapter data...');
            const freshModule = await ModuleMaster.findById(instance.moduleMasterId._id);
            const freshChapter = freshModule.chapters.id(nextChapter._id);

            if (!freshChapter) {
                throw new AppError('Failed to reload chapter data', 500);
            }

            console.log('Chapter content status:', {
                hasSummaries: freshChapter.summaries?.length || 0,
                hasLevels: freshChapter.levels?.length || 0,
                totalQuestions: freshChapter.levels?.reduce((sum, level) => sum + level.questions.length, 0) || 0
            });

            // Get available questions from reloaded chapter
            console.log('\n🔍 Analyzing available questions in chapter...');
            const availableQuestions = freshChapter.levels.reduce((acc, level) => {
                const levelQuestions = level.questions.map(q => ({
                    questionId: q._id,
                    bloomLevel: level.bloomLevel,
                    targetedConcept: q.targetedConcept
                }));
                console.log(`Found ${levelQuestions.length} questions for level ${level.bloomLevel}`);
                return [...acc, ...levelQuestions];
            }, []);

            if (availableQuestions.length === 0) {
                throw new AppError('No questions available in chapter after generation', 500);
            }

            // Distribute questions across levels
            console.log('\n📊 Creating question distribution...');
            const selectedQuestions = [];
            const baseDistribution = [
                { bloomLevel: 1, count: 2 },
                { bloomLevel: 2, count: 2 },
                { bloomLevel: 3, count: 2 },
                { bloomLevel: 4, count: 2 },
                { bloomLevel: 5, count: 1 },
                { bloomLevel: 6, count: 1 }
            ];

            // Select questions for each level
            for (const dist of baseDistribution) {
                const levelQuestions = availableQuestions.filter(q => q.bloomLevel === dist.bloomLevel);
                console.log(`Level ${dist.bloomLevel}: ${levelQuestions.length} questions available, need ${dist.count}`);

                const selected = levelQuestions
                    .sort(() => Math.random() - 0.5)
                    .slice(0, dist.count);

                selectedQuestions.push(...selected);
            }

            // Fill remaining slots if needed
            const remainingSlots = 10 - selectedQuestions.length;
            if (remainingSlots > 0) {
                console.log(`Filling ${remainingSlots} remaining slots...`);
                const unusedQuestions = availableQuestions.filter(q =>
                    !selectedQuestions.some(s => s.questionId.equals(q.questionId))
                );

                const additional = unusedQuestions
                    .sort(() => Math.random() - 0.5)
                    .slice(0, remainingSlots);

                selectedQuestions.push(...additional);
            }

            if (selectedQuestions.length !== 10) {
                throw new AppError(`Failed to select 10 questions (got ${selectedQuestions.length})`, 500);
            }

            // Create new question set
            console.log('\n📝 Creating new question set...');
            const questionSet = {
                _id: new mongoose.Types.ObjectId(),
                setNumber: 1,
                type: 'initial',
                questionRefs: selectedQuestions,
                bloomLevelDistribution: baseDistribution.reduce((acc, { bloomLevel, count }) => {
                    acc[`level${bloomLevel}`] = count;
                    return acc;
                }, {})
            };

            // Add question set to chapter
            console.log('\n💾 Adding question set to chapter...');
            await ModuleMaster.updateOne(
                {
                    _id: instance.moduleMasterId._id,
                    'chapters._id': freshChapter._id
                },
                {
                    $push: {
                        'chapters.$.questionSets': questionSet
                    }
                }
            );

            // Create new chapter progress
            console.log('\n📈 Creating chapter progress record...');
            const newChapterProgress = {
                chapterIndex: nextChapterIndex,
                status: 'in_progress',
                questionSets: [{
                    setId: questionSet._id,
                    setNumber: 1,
                    type: 'initial',
                    status: 'not_started',
                    questions: selectedQuestions.map(q => ({
                        questionId: q.questionId,
                        status: 'pending',
                        bloomLevel: q.bloomLevel
                    }))
                }]
            };

            // Update instance state
            console.log('\n🔄 Updating instance state...');
            await ModuleInstance.updateOne(
                { _id: instance._id },
                {
                    $set: {
                        'currentState.currentChapterIndex': nextChapterIndex,
                        'currentState.currentLevelIndex': 0,
                        'currentState.lastAssessmentLevel': 1,
                        'currentState.currentQuestionSetId': questionSet._id,
                    },
                    $push: {
                        chapterProgress: newChapterProgress
                    }
                }
            );

            console.log('\n✅ Chapter progression complete');

            return {
                evaluation: {
                    chapterProgression: true,
                    nextChapter: {
                        index: nextChapterIndex,
                        title: freshChapter.title
                    }
                },
                adaptiveContent: {
                    questionSetId: questionSet._id,
                    type: 'initial',
                    questions: selectedQuestions,
                    flashcardIds: []
                }
            };

        } catch (error) {
            console.error('\n❌ Error in handleChapterProgression:', error);
            throw new AppError(`Failed to handle chapter progression: ${error.message}`, 500);
        }
    }

    distributeQuestions(availableQuestions, distribution) {
        console.log('\n📊 Distributing questions according to plan...');
        const selectedQuestions = [];
        let remainingSlots = 10;

        // First try to fulfill the distribution
        for (const { bloomLevel, count } of distribution) {
            console.log(`Processing level ${bloomLevel}, need ${count} questions`);
            const levelQuestions = availableQuestions.filter(q => q.bloomLevel === bloomLevel);
            console.log(`Found ${levelQuestions.length} available questions for level ${bloomLevel}`);

            const available = Math.min(count, levelQuestions.length);

            if (available > 0) {
                const selectedForLevel = levelQuestions
                    .sort(() => Math.random() - 0.5)
                    .slice(0, available);

                selectedQuestions.push(...selectedForLevel);
                remainingSlots -= available;

                console.log(`Selected ${available} questions for level ${bloomLevel}`);
            } else {
                console.log(`⚠️ No questions available for level ${bloomLevel}`);
            }
        }

        // Fill remaining slots with random questions if needed
        if (remainingSlots > 0) {
            console.log(`\n📎 Filling ${remainingSlots} remaining slots...`);
            const unusedQuestions = availableQuestions.filter(q =>
                !selectedQuestions.some(selected => selected.questionId.equals(q.questionId))
            );

            if (unusedQuestions.length > 0) {
                const additional = unusedQuestions
                    .sort(() => Math.random() - 0.5)
                    .slice(0, remainingSlots);
                selectedQuestions.push(...additional);
                console.log(`Added ${additional.length} additional questions`);
            }
        }

        console.log('\nFinal distribution:', selectedQuestions.reduce((acc, q) => {
            acc[`level${q.bloomLevel}`] = (acc[`level${q.bloomLevel}`] || 0) + 1;
            return acc;
        }, {}));

        return selectedQuestions;
    }

    async generateChapterContentWithRetry(chapter, pdfContent, preferredLanguage, maxRetries = 10) {
        let attempt = 0;
        while (attempt < maxRetries) {
            try {
                console.log(`\nAttempting to generate content for chapter "${chapter.title}" (Attempt ${attempt + 1}/${maxRetries})`);

                // Generate flashcards
                console.log('Generating flashcards...');
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
                chapter.summaries = flashcards.map(card => ({
                    content: card.content,
                    comprehensionLevel: card.comprehensionLevel,
                    flashcardFront: card.flashcardFront,
                    flashcardBack: card.flashcardBack,
                    relatedConcepts: card.relatedConcepts || [],
                    practicePrompt: card.practicePrompt || ''
                }));

                // Generate assessment questions
                console.log('Generating assessment questions...');
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

                // Group questions by Bloom's level
                const questionsByLevel = questions.reduce((acc, q) => {
                    if (!acc[q.bloomLevel]) acc[q.bloomLevel] = [];
                    acc[q.bloomLevel].push({
                        ...q,
                        difficultyLevel: q.difficultyLevel || 1,
                        learningObjective: q.learningObjective || `Understand ${q.targetedConcept || 'the concept'}`,
                        targetedConcept: q.targetedConcept || 'Core concept'
                    });
                    return acc;
                }, {});

                chapter.levels = Object.entries(questionsByLevel).map(([level, questions]) => ({
                    bloomLevel: parseInt(level),
                    questions
                }));

                console.log(`✅ Chapter "${chapter.title}" content generated successfully`);
                return true;

            } catch (error) {
                console.error(`Error generating content for chapter "${chapter.title}" (Attempt ${attempt + 1}):`, error);

                // If we've reached max retries, throw the error
                if (attempt === maxRetries - 1) {
                    throw new Error(`Failed to generate content for chapter "${chapter.title}" after ${maxRetries} attempts: ${error.message}`);
                }

                // Wait before retrying (exponential backoff)
                const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
                console.log(`Waiting ${delay}ms before retrying...`);
                await new Promise(resolve => setTimeout(resolve, delay));

                attempt++;
            }
        }
    }

    async createModuleWithContent(pdfPath, userId, title, description, preferredLanguage, pdfUrl, existingModuleId) {
        try {
            console.log('\n=== Starting Module Content Generation ===');
            console.log('Existing Module ID:', existingModuleId);

            // 1. Read and validate PDF file
            const fileBuffer = await fs.readFile(pdfPath);
            const base64Data = fileBuffer.toString('base64');

            // 2. Generate metadata and chapter structure in parallel
            console.log('Generating initial metadata and chapter structure...');
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

            // 3. Process responses
            const metadata = processAIResponse(metadataResult.response.text(), 'metadata');
            const chapters = processAIResponse(chapterResult.response.text(), 'chapters');

            // 4. Prepare chapter data
            const chapterData = chapters.map(chapter => ({
                title: chapter.title,
                order: chapter.order,
                excerpt: chapter.excerpt,
                summaries: [],
                levels: []
            }));

            // 5. Update existing module instead of creating new one
            const updatedModule = await ModuleMaster.findByIdAndUpdate(
                existingModuleId,
                {
                    $set: {
                        title: title || metadata.title,
                        description: description || metadata.description,
                        excerpt: chapters[0]?.excerpt || metadata.excerpt,
                        chapters: chapterData,
                        status: 'completed'
                    }
                },
                { new: true }
            );

            if (!updatedModule) {
                throw new AppError('Failed to update module', 500);
            }

            // 6. Generate content for each chapter
            console.log(`\nGenerating content for ${chapters.length} chapters...`);
            for (let i = 0; i < updatedModule.chapters.length; i++) {
                const chapter = updatedModule.chapters[i];
                await this.generateChapterContentWithRetry(chapter, base64Data, preferredLanguage);

                // Save progress after each chapter
                await ModuleMaster.updateOne(
                    { _id: updatedModule._id, 'chapters._id': chapter._id },
                    {
                        $set: {
                            'chapters.$.summaries': chapter.summaries,
                            'chapters.$.levels': chapter.levels
                        }
                    }
                );
            }

            // 7. Return updated module
            return await ModuleMaster.findById(updatedModule._id);

        } catch (error) {
            console.error('Error in createModuleWithContent:', error);
            throw new AppError(`Failed to create module with content: ${error.message}`, error.statusCode || 500);
        }
    }
}

module.exports = new ModuleService();