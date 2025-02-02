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
Analyze the student's assessment performance in detail. You are evaluating their understanding of the material
and determining if they need a new adapted question set.

Assessment Context:
- Current Bloom's Level: {currentLevel}
- Current Difficulty Level: {currentDifficultyLevel}
- Total Questions Attempted: {questionCount}
- Correct Answers: {correctCount}
- Detailed Answers: {answers}
- Attempted Sets Count: {attemptedSetsCount}
- Last Set Score: {lastSetScore}
- Attempts At New Level: {attemptsAtNewLevel}
- Recently Increased Difficulty : {recentlyIncreasedDifficulty}
- Consistent Performance : {consistentPerformance}
- Concept Mastery At Current Level : {conceptMasteryAtCurrentLevel}
- Bloom Mastery Levels 1-2: {bloomMastery_1_2}
- Bloom Mastery Levels 3-4: {bloomMastery_3_4}
- Bloom Mastery Levels 5-6: {bloomMastery_5_6}

Evaluation Requirements:
1. Calculate comprehension score (0-100) based on:
   - Correct answers percentage
   - Question difficulty levels
   - Answer patterns within each Bloom's level

2. Analyze learning progression:
   - Compare performance across different Bloom's levels
   - Identify concepts that need reinforcement
   - Evaluate readiness for level progression

3. Identify specific knowledge gaps:
   - List specific topics where errors occurred
   - Group related misconceptions
   - Note patterns in incorrect answers

4. Determine mastery and adaptation needs based on the following logic:

   - **Chapter Progression:** If ALL the following conditions are true, then:
        - Set 'recommendedLevel' to {currentLevel + 1} (increase the level by one).
        - Set 'needsAdaptation' to true.
        - The conditions are:
            - Score is greater than or equal to 80.
            - Current Difficulty Level is greater than or equal to 4.
            - Attempted Sets Count is greater than or equal to 3.
            - Bloom Mastery Levels 1-2 is greater than or equal to 85%.
            - Bloom Mastery Levels 3-4 is greater than or equal to 80%.
            - Bloom Mastery Levels 5-6 is greater than or equal to 75%.
            - Consistent Performance is true (last 2 sets above 75%).

   - **Harder Adaptation:** If ANY of the following conditions are true, then:
       - Set 'needsAdaptation' to true.
     - If Score >= 85, Current Difficulty Level < 5, and Last Set Score >= 80, then increase difficulty.
     - If Score >= 80, Current Bloom Level < 6, and Concept Mastery At Current Level >= 80, then increase the bloom level.

    - **Maintain Level:** If ANY of the following conditions are true, then:
          - Set 'needsAdaptation' to false.
      - If Score is between 70 and 84, Current Difficulty Level is greater than or equal to 3, and Consistent Performance is true.
      - If Score is greater than or equal to 75, Recently Increased Difficulty is true, and Attempts At New Level is less than 2.

    - **Easier Adaptation:** If ANY of the following conditions are true, then:
        - Set 'needsAdaptation' to true.
        - If Score < 60 and Attempts At Current Level >= 2, decrease the difficulty.
        - If Score < 50 and Current Difficulty Level > 1, immediately decrease the difficulty.

    - If none of the above conditions for chapter progression were met, then:
       - Set 'recommendedLevel' to the current level.
       - If 'needsAdaptation' was not already set to true, then set 'needsAdaptation' to false.


Return response in JSON format:
{
  "score": number (0-100),
  "recommendedLevel": number (1-6),
  "needsAdaptation": boolean,
  "weakAreas": [
    {
      "topic": "string (specific topic/concept)",
      "bloomLevel": number (1-6),
      "detectedIssues": ["string (specific misconceptions)"],
      "recommendedFocus": "string (what to focus on)"
    }
  ],
  "strengths": [
    {
      "topic": "string (mastered topic/concept)",
      "bloomLevel": number (1-6),
      "demonstratedSkills": ["string (specific skills shown)"]
    }
  ],
  "adaptationStrategy": {
    "focusAreas": ["string (specific topics to target)"],
    "recommendedApproach": "string (detailed learning strategy)",
    "questionDistribution": [
      {
        "bloomLevel": number (1-6),
        "count": number (questions to generate at this level),
        "topics": ["string (topics to cover)"]
      }
    ]
  }
}
`;

const ADAPTIVE_CONTENT_PROMPT = JSON_FORMAT_RULES + `
Generate a new complete assessment set based on the evaluation results. The set must include exactly 10 questions
and targeted flashcards for reinforcement.

Adaptation Context:
- Target Bloom's Level: {targetLevel}
- Focus Areas: {focusAreas}
- Weak Concepts: {weakConcepts}
- Current Chapter: {chapterTitle}

Requirements for Question Generation:
1. Generate exactly 10 questions that:
   - Target identified weak areas
   - Follow the recommended level distribution
   - Provide scaffolded learning progression
   - Include detailed explanations

2. Each question must:
   - Address specific misconceptions
   - Include clear learning objectives
   - Provide comprehensive explanations
   - Follow multiple-choice format

3. Generate targeted flashcards that:
   - Focus on weak areas
   - Provide foundational knowledge
   - Include practice exercises
   - Support concept mastery

Return response in JSON format:
{
  "questions": [{
    "question": "string (clear, focused question)",
    "options": ["string (4 options)"],
    "correctAnswer": number (0-3),
    "explanation": "string (detailed explanation including why other options are incorrect)",
    "bloomLevel": number (1-6),
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
    "recommendedStudyOrder": ["string (ordered concepts)"]
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