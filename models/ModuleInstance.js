const mongoose = require('mongoose');

const masteredLevelSchema = new mongoose.Schema({
    chapterId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    levelId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    masteredAt: {
        type: Date,
        default: Date.now
    }
});

const currentQuestionSchema = new mongoose.Schema({
    questionId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed'],
        default: 'pending'
    },
    userAnswer: Number,
    isCorrect: Boolean,
    answeredAt: Date
});

const adaptiveHistorySchema = new mongoose.Schema({
    timestamp: {
        type: Date,
        default: Date.now
    },
    previousLevel: {
        type: Number,
        required: true,
        min: 1,
        max: 6
    },
    newLevel: {
        type: Number,
        required: true,
        min: 1,
        max: 6
    },
    assessmentScore: {
        type: Number,
        required: true,
        min: 0,
        max: 100
    },
    understandingAnalysis: {
        bloomLevelDistribution: {
            level1: Number,
            level2: Number,
            level3: Number,
            level4: Number,
            level5: Number,
            level6: Number
        },
        strengths: [String],
        weakAreas: [String]
    },
    masteryStatus: {
        isMastered: Boolean,
        consecutiveSuccesses: Number,
        remainingAttemptsForMastery: Number
    },
    adaptationDetails: {
        adaptationType: {
            type: String,
            enum: ['level_up', 'level_down', 'reinforce', 'challenge']
        },
        focusAreas: [String],
        recommendedApproach: String,
        targetBloomLevels: [{
            level: Number,
            percentage: Number
        }]
    },
    generatedQuestions: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Question'
    }],
    generatedFlashcards: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Summary'
    }],
    chapterProgress: {
        currentChapter: Number,
        isReadyForNextChapter: Boolean,
        masteryPercentage: Number
    }
});

const currentQuestionSetSchema = new mongoose.Schema({
    questions: [{
        questionId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        },
        status: {
            type: String,
            enum: ['active', 'answered', 'skipped'],
            default: 'active'
        },
        assignedAt: {
            type: Date,
            default: Date.now
        },
        expiresAt: {
            type: Date
            // Bisa ditambah TTL untuk auto-expire jika user tidak menyelesaikan
        }
    }],
    attemptNumber: {
        type: Number,
        default: 1
    },
    setStatus: {
        type: String,
        enum: ['in_progress', 'completed', 'expired'],
        default: 'in_progress'
    }
});

const ModuleInstanceSchema = new mongoose.Schema({
    moduleMasterId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ModuleMaster',
        required: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },
    currentState: {
        currentChapterIndex: {
            type: Number,
            default: 0
        },
        currentLevelIndex: {
            type: Number,
            default: 0
        },
        comprehensionScore: {
            type: Number,
            default: 0,
            min: 0,
            max: 100
        },
        lastAssessmentLevel: {
            type: Number,
            default: 1,
            min: 1,
            max: 6
        }
    },
    currentQuestionSet: {
        type: currentQuestionSetSchema,
        default: () => ({}) // Initialize empty by default
    },
    progress: {
        completedChapters: [{
            type: mongoose.Schema.Types.ObjectId
        }],
        masteredLevels: [masteredLevelSchema],
        currentQuestions: [currentQuestionSchema]
    },
    adaptiveHistory: [adaptiveHistorySchema],
    startedAt: {
        type: Date,
        default: Date.now
    },
    lastAccessedAt: {
        type: Date,
        default: Date.now
    },
    completedAt: Date,
    status: {
        type: String,
        enum: ['in_progress', 'completed', 'abandoned'],
        default: 'in_progress'
    }
}, {
    timestamps: true
});



// Indexes
ModuleInstanceSchema.index({ userId: 1, moduleMasterId: 1 }, { unique: true });
ModuleInstanceSchema.index({ status: 1 });
ModuleInstanceSchema.index({ lastAccessedAt: -1 });

module.exports = {
    ModuleInstance: mongoose.model('ModuleInstance', ModuleInstanceSchema)
};