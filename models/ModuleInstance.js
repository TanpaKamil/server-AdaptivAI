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
    generatedQuestions: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Question'
    }]
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