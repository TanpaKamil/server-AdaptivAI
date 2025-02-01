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
                flashcardBack: card.flashcardBack || ''
            }));

        case 'questions':
            // Check if we received an object with questions property
            const questionsArray = parsed.questions || parsed;

            if (!Array.isArray(questionsArray)) {
                throw new Error('Questions response must be an array');
            }

            const validatedQuestions = questionsArray.map(question => ({
                question: question.question || '',
                options: Array.isArray(question.options) ? question.options : [],
                correctAnswer: question.correctAnswer ?? 0, // Using nullish coalescing
                explanation: question.explanation || '',
                bloomLevel: question.bloomLevel || 1,
                focusArea: question.focusArea || '' // Tambahkan focusArea
            }));

            // If we have flashcards, include them in the response
            if (parsed.newFlashcards) {
                return {
                    questions: validatedQuestions,
                    newFlashcards: parsed.newFlashcards.map(card => ({
                        content: card.content || '',
                        comprehensionLevel: card.comprehensionLevel || 1,
                        flashcardFront: card.flashcardFront || '',
                        flashcardBack: card.flashcardBack || ''
                    }))
                };
            }

            return validatedQuestions;

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