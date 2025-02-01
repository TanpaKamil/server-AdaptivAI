// src/services/moduleService.js
const { ModuleMaster, ModuleInstance } = require('../models/ModuleMaster');
const geminiConfig = require('../config/gemini');
const { AppError } = require('../middlewares/errorHandler');
const {
  LANGUAGE_PROMPT,
  CHAPTER_IDENTIFICATION_PROMPT,
  FLASHCARD_GENERATION_PROMPT,
  ASSESSMENT_GENERATION_PROMPT,
  EVALUATION_PROMPT,
  ADAPTIVE_CONTENT_PROMPT
} = require('./ai/prompts/modulePrompts');

class ModuleService {
  async createModule(pdfPath, userId, title, description, preferredLanguage) {
    try {
      // Upload PDF to Gemini
      const file = await geminiConfig.uploadFile(pdfPath, 'application/pdf');
      await geminiConfig.waitForFilesActive([file]);

      // Start chat session
      const chatSession = geminiConfig.startChat();
      
      // Check language and get confirmation
      const languageResponse = await chatSession.sendMessage({
        text: LANGUAGE_PROMPT,
        context: { preferredLanguage }
      });
      
      const languageCheck = JSON.parse(languageResponse.text());
      if (!languageCheck.canProceed) {
        throw new AppError('Document language processing failed', 400);
      }

      // Identify chapters with excerpts
      const chaptersResponse = await chatSession.sendMessage({
        text: CHAPTER_IDENTIFICATION_PROMPT
      });
      
      const chapters = JSON.parse(chaptersResponse.text());
      
      // Create module with identified chapters
      const module = await ModuleMaster.create({
        title,
        description,
        createdBy: userId,
        chapters: chapters.map(chapter => ({
          title: chapter.title,
          order: chapter.order,
          excerpt: chapter.excerpt,
          summaries: [],
          levels: []
        }))
      });

      return module;
    } catch (error) {
      console.error('Error creating module:', error);
      throw new AppError('Failed to create module', 500);
    }
  }

  async generateChapterContent(moduleId, chapterId, preferredLanguage) {
    const module = await ModuleMaster.findById(moduleId);
    if (!module) throw new AppError('Module not found', 404);

    const chapter = module.chapters.id(chapterId);
    if (!chapter) throw new AppError('Chapter not found', 404);

    const chatSession = geminiConfig.startChat();

    // Generate flashcards with comprehensive coverage
    const flashcardsResponse = await chatSession.sendMessage({
      text: FLASHCARD_GENERATION_PROMPT,
      context: {
        chapterTitle: chapter.title,
        preferredLanguage
      }
    });

    const flashcards = JSON.parse(flashcardsResponse.text());
    chapter.summaries = flashcards;

    // Generate initial assessment questions
    const questionsResponse = await chatSession.sendMessage({
      text: ASSESSMENT_GENERATION_PROMPT,
      context: {
        chapterTitle: chapter.title,
        flashcards,
        preferredLanguage
      }
    });

    const questions = JSON.parse(questionsResponse.text());
    
    // Organize questions by Bloom's level
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
  }

  async evaluateAndAdapt(moduleInstanceId, answers, preferredLanguage) {
    const instance = await ModuleInstance.findById(moduleInstanceId)
      .populate('moduleMasterId');
    
    if (!instance) throw new AppError('Module instance not found', 404);

    const chatSession = geminiConfig.startChat();

    // Evaluate comprehension and determine adaptation needs
    const evalResponse = await chatSession.sendMessage({
      text: EVALUATION_PROMPT,
      context: {
        currentLevel: instance.currentState.lastAssessmentLevel,
        questionCount: answers.length,
        correctCount: answers.filter(a => a.isCorrect).length,
        answers,
        preferredLanguage
      }
    });

    const evaluation = JSON.parse(evalResponse.text());

    // Update instance with evaluation results
    instance.currentState.comprehensionScore = evaluation.score;
    instance.currentState.lastAssessmentLevel = evaluation.recommendedLevel;

    if (evaluation.needsAdaptation) {
      // Generate adapted content based on evaluation
      const adaptiveResponse = await chatSession.sendMessage({
        text: ADAPTIVE_CONTENT_PROMPT,
        context: {
          targetLevel: evaluation.recommendedLevel,
          focusAreas: evaluation.adaptationStrategy.focusAreas,
          weakConcepts: evaluation.weakAreas,
          preferredLanguage
        }
      });

      const adaptiveContent = JSON.parse(adaptiveResponse.text());
      
      // Update module master with new content
      const chapter = instance.moduleMasterId.chapters[instance.currentState.currentChapterIndex];
      
      // Add new questions to appropriate level
      const level = chapter.levels.find(l => l.bloomLevel === evaluation.recommendedLevel);
      level.questions.push(...adaptiveContent.questions);
      
      // Add new flashcards if provided
      if (adaptiveContent.newFlashcards?.length > 0) {
        chapter.summaries.push(...adaptiveContent.newFlashcards);
      }
      
      await instance.moduleMasterId.save();
      
      // Record adaptation history
      instance.adaptiveHistory.push({
        previousLevel: instance.currentState.lastAssessmentLevel,
        newLevel: evaluation.recommendedLevel,
        assessmentScore: evaluation.score,
        generatedQuestions: adaptiveContent.questions.map(q => q._id)
      });
    }

    await instance.save();
    return {
      evaluation,
      instance
    };
  }
}

module.exports = new ModuleService();