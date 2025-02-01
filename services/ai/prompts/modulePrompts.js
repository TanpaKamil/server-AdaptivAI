// src/services/ai/prompts/modulePrompts.js

const LANGUAGE_PROMPT = `
I will provide you with a document. Before analyzing the content, I need you to:
1. Detect the primary language of the document
2. Based on user's preferred learning language (which I will provide), you should:
   - If document language matches preferred language: proceed normally
   - If different: translate all your future responses to the preferred language

Return response in JSON format:
{
  "detectedLanguage": "string",
  "canProceed": true
}
`;

const CHAPTER_IDENTIFICATION_PROMPT = `
Analyze the document content and structure carefully. For each identified chapter:
1. Extract the main title
2. Determine logical order
3. Create a brief excerpt summarizing key points (max 150 characters)

Ensure chapters are properly sequenced and represent distinct learning units.

Return response in JSON format:
[{
  "title": "string",
  "order": number,
  "excerpt": "string"
}]
`;

const FLASHCARD_GENERATION_PROMPT = `
For the given chapter title and content, create comprehensive flashcards that:
1. Cover all key concepts progressively
2. Align with Bloom's Taxonomy levels (1-6)
3. Include clear, concise front and detailed back content
4. Ensure logical learning progression
5. Support deep understanding

For each concept create:
- Basic recall flashcards (Level 1-2)
- Understanding verification flashcards (Level 3-4)
- Application/Analysis flashcards (Level 5-6)

Return response in JSON format:
[{
  "content": "string (key concept)",
  "comprehensionLevel": number (1-6),
  "flashcardFront": "string (question/prompt)",
  "flashcardBack": "string (detailed explanation)"
}]
`;

const ASSESSMENT_GENERATION_PROMPT = `
Create a comprehensive assessment for the chapter that:
1. Covers all identified key concepts
2. Distributes questions across all Bloom's levels (1-6)
3. Ensures clear, unambiguous questions
4. Provides plausible distractors
5. Includes detailed explanations

Questions should follow Bloom's Taxonomy:
Level 1 (Remember): Recall of facts
Level 2 (Understand): Explain concepts
Level 3 (Apply): Use information in new situations
Level 4 (Analyze): Draw connections
Level 5 (Evaluate): Justify a stand/decision
Level 6 (Create): Produce new content

Return response in JSON format:
[{
  "question": "string",
  "options": ["string", "string", "string", "string"],
  "correctAnswer": number (0-3),
  "explanation": "string",
  "bloomLevel": number (1-6)
}]
`;

const EVALUATION_PROMPT = `
Analyze the user's answers and performance to:
1. Calculate comprehension score
2. Determine mastery level
3. Identify knowledge gaps
4. Recommend appropriate Bloom's level
5. Decide if adaptation is needed

Consider:
- Current Bloom's level: {currentLevel}
- Questions attempted: {questionCount}
- Correct answers: {correctCount}
- Pattern of errors
- Time taken per question

Return response in JSON format:
{
  "score": number (0-100),
  "recommendedLevel": number (1-6),
  "needsAdaptation": boolean,
  "weakAreas": ["string"],
  "strengths": ["string"],
  "adaptationStrategy": {
    "focusAreas": ["string"],
    "recommendedApproach": "string"
  }
}
`;

const ADAPTIVE_CONTENT_PROMPT = `
Based on the evaluation results, generate adapted content that:
1. Addresses identified knowledge gaps
2. Reinforces weak areas
3. Maintains appropriate difficulty
4. Provides scaffolded learning
5. Targets specific Bloom's level: {targetLevel}

Focus areas: {focusAreas}
Weak concepts: {weakConcepts}

Return response in JSON format:
{
  "questions": [{
    "question": "string",
    "options": ["string"],
    "correctAnswer": number,
    "explanation": "string",
    "bloomLevel": number,
    "focusArea": "string"
  }],
  "newFlashcards": [{
    "content": "string",
    "comprehensionLevel": number,
    "flashcardFront": "string",
    "flashcardBack": "string"
  }]
}
`;

module.exports = {
  LANGUAGE_PROMPT,
  CHAPTER_IDENTIFICATION_PROMPT,
  FLASHCARD_GENERATION_PROMPT,
  ASSESSMENT_GENERATION_PROMPT,
  EVALUATION_PROMPT,
  ADAPTIVE_CONTENT_PROMPT
};