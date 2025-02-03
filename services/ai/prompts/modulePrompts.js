const JSON_FORMAT_RULES = `
IMPORTANT: Follow these rules strictly when generating JSON responses:
1. Escape all special characters in strings using proper JSON escaping:
   - Use \\" for quotes
   - Use \\n for newlines
   - Use \\t for tabs
   - Use \\r for carriage returns
2. Avoid using any unescaped control characters in strings
3. Ensure all string values are properly quoted
4. Use valid JSON boolean values (true/false) not strings
5. Use proper number format for numeric values
6. Ensure all arrays and objects are properly closed
7. Do not include any explanatory text outside the JSON structure
8. Do not include any markdown or formatting within strings
9. Ensure all property names are quoted
10. Maximum string length for any single value: 1000 characters

Example of properly formatted response:
{
  "title": "Sample Title",
  "description": "This is a description\\nWith a new line",
  "numeric_value": 42,
  "is_valid": true,
  "array_value": ["item1", "item2"]
}
`;

const LANGUAGE_PROMPT = JSON_FORMAT_RULES + `
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

const CHAPTER_IDENTIFICATION_PROMPT = JSON_FORMAT_RULES + `
Analyze the document content and structure carefully. For each identified chapter:
1. Extract the main title
2. Determine logical order
3. Create a brief excerpt summarizing key points (max 150 characters)
4. Makesure to not include subchapters as chapters.

Ensure chapters are properly sequenced and represent distinct learning units.

Return response in JSON format:
[{
  "title": "string",
  "order": number,
  "excerpt": "string"
}]
`;

const FLASHCARD_GENERATION_PROMPT = JSON_FORMAT_RULES + `
For the given chapter title and content, create comprehensive flashcards that:
1. Cover all key concepts of that given chapter progressively
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
  "flashcardBack": "string (detailed explanation)",
  "relatedConcepts": "[string,..,string]" (related concepts in the module/chapters explained by the flashcard)
}]
`;

const ASSESSMENT_GENERATION_PROMPT = JSON_FORMAT_RULES + `
Create a comprehensive assessment for the chapter that:
1. Covers all identified key concepts
2. Provides both cognitive complexity (Bloom's) and difficulty levels
3. Ensures clear, unambiguous questions
4. Provides plausible distractors
5. Includes detailed explanations
6. Total of 10 Questions
7. Must be multiple choice questions
8. All the Bloom's level must exist (total 6 levels)

Cognitive Complexity (Bloom's Taxonomy):
Level 1 (Remember): Basic recall of facts and definitions
Level 2 (Understand): Explain concepts and principles
Level 3 (Apply): Use information in new situations
Level 4 (Analyze): Draw connections and relationships
Level 5 (Evaluate): Make judgments based on criteria
Level 6 (Create): Generate new ideas or perspectives

Difficulty Levels:
Level 1 (Very Easy): Most students can answer correctly
Level 2 (Easy): Many students can answer correctly
Level 3 (Moderate): Average difficulty, requires good understanding
Level 4 (Hard): Challenging, requires deep understanding
Level 5 (Very Hard): Most challenging, requires mastery

Note: Bloom's level and difficulty level are independent. A question can be:
- High Bloom's (6) but low difficulty (1)
- Low Bloom's (1) but high difficulty (5)

Return response in JSON format:
[{
  "question": "string (clear, focused question)",
  "options": ["string", "string", "string", "string"],
  "correctAnswer": number (0-3),
  "explanation": "string (detailed explanation)",
  "bloomLevel": number (1-6, required, indicates cognitive complexity),
  "difficultyLevel": number (1-5, required, indicates challenge level),
  "learningObjective": "string (what student should learn)",
  "targetedConcept": "string (specific concept being tested)"
}]

Example:
{
  "question": "What is the definition of osmosis?",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "correctAnswer": 0,
  "explanation": "Detailed explanation here",
  "bloomLevel": 1,           // Remember - just recalling a definition
  "difficultyLevel": 4,      // Hard - despite being recall, the concept is complex
  "learningObjective": "Understand the basic concept of osmosis",
  "targetedConcept": "Osmosis"
}
`;


const EVALUATION_PROMPT = JSON_FORMAT_RULES + `
Analyze the student's assessment performance and determine if they should progress.

Assessment Context:
- Current Bloom's Level: {currentLevel}
- Total Questions Attempted: {questionCount}
- Correct Answers: {correctCount}
- Detailed Answers: {answers}
- Performance By Level: {performanceByLevel}
- Previous Sets Performance: {previousSets}

Progression Rules:
1. Chapter Progression:
   - Current level must be 6
   - Score must be >= 80%

2. Level Changes:
   - If score < 50%: Move down one level
   - If score >= 85% and not at level 6: Move up one level
   - Otherwise: Stay at current level

3. Performance Analysis Requirements:
   - Identify concepts with performance >= 80% as strengths
   - Identify concepts with performance < 70% as weak areas
   - Track specific skills demonstrated in correct answers
   - Note specific issues in incorrect answers
   - Provide focused recommendations for improvement

Return response in JSON format:
{
  "score": number (0-100),
  "recommendedLevel": number (1-6),
  "needsAdaptation": boolean,
  "adaptationType": "level_up" | "level_down" | "reinforce" | "chapter_progress",
  "weakAreas": [{
    "topic": "string (specific concept)",
    "bloomLevel": number (level where issue occurred),
    "detectedIssues": ["string (specific performance issues)"],
    "recommendedFocus": "string (specific improvement strategy)"
  }],
  "strengths": [{
    "topic": "string (specific concept)",
    "bloomLevel": number (highest level demonstrated),
    "demonstratedSkills": ["string (specific abilities shown)"]
  }],
  "adaptationStrategy": {
    "focusAreas": ["string"],
    "recommendedApproach": "string",
    "questionDistribution": [{
      "bloomLevel": number,
      "count": number,
      "topics": ["string"],
      "reasoning": "string"
    }]
  }
}
`;

const ADAPTIVE_CONTENT_PROMPT = JSON_FORMAT_RULES + `
Generate a new assessment set following the provided distribution exactly.

Context:
- Target Bloom's Level: {targetLevel}
- Focus Areas: {focusAreas}
- Weak Concepts: {weakConcepts}
- Current Chapter: {chapterTitle}
- Required Question Distribution: {questionDistribution}

Requirements:
1. Follow the provided question distribution exactly:
   {questionDistribution}
   - Generate exactly the specified number of questions for each level
   - Total must be exactly 10 questions (non-negotiable)
   - Each question's bloomLevel must match the distribution

2. Each question must:
   - Match the specified Bloom's level exactly
   - Include clear learning objectives
   - Provide comprehensive explanations
   - Follow multiple-choice format with 4 options

3. Generate supporting flashcards that:
   - Match the concepts from questions
   - Support mastery of key topics

Return response in JSON format:
{
  "questions": [{
    "question": "string (clear, focused question)",
    "options": ["string (4 options)"],
    "correctAnswer": number (0-3),
    "explanation": "string (detailed explanation including why other options are incorrect)",
    "bloomLevel": number (MUST match distribution),
    "targetedConcept": "string (specific concept being tested)",
    "learningObjective": "string (what this question aims to assess)"
  }],
  "newFlashcards": [{
    "content": "string (core concept)",
    "comprehensionLevel": number (1-6),
    "flashcardFront": "string (question/prompt)",
    "flashcardBack": "string (detailed explanation)",
    "relatedConcepts": ["string (connected topics)"],
    "practicePrompt": "string (application exercise)"
  }],
  "adaptationMetadata": {
    "targetedWeakAreas": ["string (areas being addressed)"],
    "learningProgression": "string (how this set builds understanding)",
    "recommendedStudyOrder": ["string (ordered concepts)"],
    "distributionFollowed": boolean (must be true),
    "bloomLevelCounts": {
      "level1": number,
      "level2": number,
      "level3": number,
      "level4": number,
      "level5": number,
      "level6": number
    }
  }
}
`;

const MODULE_METADATA_PROMPT = JSON_FORMAT_RULES + `
Analyze this document and generate a suitable title and description for a learning module.

Requirements:
1. Title should be concise but descriptive (max 100 characters)
2. Description should summarize the main learning objectives (max 250 characters)
3. Excerpt should highlight key takeaways (max 150 characters)

Return in JSON format:
{
  "title": "string",
  "description": "string",
  "excerpt": "string"
}
`;

module.exports = {
    MODULE_METADATA_PROMPT,
    LANGUAGE_PROMPT,
    CHAPTER_IDENTIFICATION_PROMPT,
    FLASHCARD_GENERATION_PROMPT,
    ASSESSMENT_GENERATION_PROMPT,
    EVALUATION_PROMPT,
    ADAPTIVE_CONTENT_PROMPT
};