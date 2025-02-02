// src/utils/aiResponseHelper.js

/**
 * Cleans the AI response text and returns valid JSON
 * @param {string} responseText - Raw response text from AI
 * @returns {object} Parsed JSON object
 */
const cleanAndParseAIResponse = (responseText) => {
    try {
        // Remove code block markers and language identifier
        let cleaned = responseText.replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        // Sometimes AI might wrap response in quotes, remove them
        if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
            cleaned = cleaned.slice(1, -1);
        }

        // Handle potential escaped newlines
        cleaned = cleaned.replace(/\\n/g, '\n');

        // Try to parse the cleaned text
        return JSON.parse(cleaned);
    } catch (error) {
        console.error('Original response:', responseText);
        console.error('Cleaning error:', error);
        throw new Error(`Failed to parse AI response: ${error.message}`);
    }
};

/**
 * Validates that the response matches expected schema
 * @param {object} parsed - Parsed JSON object
 * @param {string} type - Type of response to validate
 * @returns {object} Validated object
 */
const validateAIResponse = (parsed, type) => {
    switch (type) {
        case 'metadata':
            return {
                title: parsed.title || 'Untitled',
                description: parsed.description || '',
                excerpt: parsed.excerpt || ''
            };

        case 'chapters':
            if (!Array.isArray(parsed)) {
                throw new Error('Chapters response must be an array');
            }
            return parsed.map(chapter => ({
                title: chapter.title || 'Untitled Chapter',
                order: chapter.order || 0,
                excerpt: chapter.excerpt || ''
            }));

        case 'flashcards':
            if (!Array.isArray(parsed)) {
                throw new Error('Flashcards response must be an array');
            }

            return parsed.map(card => ({
                content: card.content || '',
                comprehensionLevel: card.comprehensionLevel || 1,
                flashcardFront: card.flashcardFront || '',
                flashcardBack: card.flashcardBack || '',
                relatedConcepts: Array.isArray(card.relatedConcepts) ? card.relatedConcepts : [],
                practicePrompt: card.practicePrompt || '',
                adaptiveFor: card.adaptiveFor ? {
                    weakArea: card.adaptiveFor.weakArea || '',
                    bloomLevel: card.adaptiveFor.bloomLevel || 1,
                    generatedAt: card.adaptiveFor.generatedAt || new Date()
                } : null
            }));

        case 'questions':
            const questionsArray = parsed.questions || parsed;

            if (!Array.isArray(questionsArray)) {
                throw new Error('Questions response must be an array');
            }

            return questionsArray.map(question => ({
                question: question.question || '',
                options: Array.isArray(question.options) ? question.options : [],
                correctAnswer: question.correctAnswer ?? 0,
                explanation: question.explanation || '',
                bloomLevel: question.bloomLevel || 1,
                // Add validation for new required fields
                difficultyLevel: question.difficultyLevel || 1,
                learningObjective: question.learningObjective || 'Understand the basic concept',
                targetedConcept: question.targetedConcept || 'Core concept',
                focusArea: question.focusArea || ''
            }));

        case 'evaluation':
            return {
                score: parsed.score || 0,
                recommendedLevel: parsed.recommendedLevel || 1,
                needsAdaptation: !!parsed.needsAdaptation,
                weakAreas: Array.isArray(parsed.weakAreas) ? parsed.weakAreas : [],
                strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
                adaptationStrategy: parsed.adaptationStrategy || {
                    focusAreas: [],
                    recommendedApproach: ''
                }
            };

        case 'adaptiveContent':
            if (!parsed.questions || !Array.isArray(parsed.questions)) {
                throw new Error('Invalid adaptive content: questions must be an array');
            }

            return {
                questions: parsed.questions.map(q => ({
                    question: q.question || '',
                    options: Array.isArray(q.options) ? q.options : [],
                    correctAnswer: q.correctAnswer ?? 0,
                    explanation: q.explanation || '',
                    bloomLevel: q.bloomLevel || 1,
                    difficultyLevel: q.difficultyLevel || 1,
                    learningObjective: q.learningObjective || 'Understand the concept',
                    targetedConcept: q.targetedConcept || 'Core concept'
                })),
                newFlashcards: Array.isArray(parsed.newFlashcards) ? parsed.newFlashcards.map(f => ({
                    content: f.content || '',
                    comprehensionLevel: f.comprehensionLevel || 1,
                    flashcardFront: f.flashcardFront || '',
                    flashcardBack: f.flashcardBack || '',
                    relatedConcepts: Array.isArray(f.relatedConcepts) ? f.relatedConcepts : [],
                    practicePrompt: f.practicePrompt || ''
                })) : [],
                adaptationMetadata: {
                    targetedWeakAreas: Array.isArray(parsed.adaptationMetadata?.targetedWeakAreas)
                        ? parsed.adaptationMetadata.targetedWeakAreas
                        : [],
                    learningProgression: parsed.adaptationMetadata?.learningProgression || '',
                    recommendedStudyOrder: Array.isArray(parsed.adaptationMetadata?.recommendedStudyOrder)
                        ? parsed.adaptationMetadata.recommendedStudyOrder
                        : []
                }
            };

        default:
            return parsed;
    }
};

/**
 * Process AI response with cleaning and validation
 * @param {string} responseText - Raw response text from AI
 * @param {string} type - Type of response to validate
 * @returns {object} Processed and validated response
 */
const processAIResponse = (responseText, type) => {
    const cleaned = cleanAndParseAIResponse(responseText);
    return validateAIResponse(cleaned, type);
};

module.exports = {
    cleanAndParseAIResponse,
    validateAIResponse,
    processAIResponse
};