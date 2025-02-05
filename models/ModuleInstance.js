// src/models/ModuleInstance.js
const mongoose = require('mongoose');

const questionAttemptSchema = new mongoose.Schema({
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
    answeredAt: Date,
    timeSpent: Number,  // in seconds
    attemptCount: {
        type: Number,
        default: 1
    }
});

const questionSetProgressSchema = new mongoose.Schema({
    setId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    setNumber: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        enum: ['initial', 'adaptive'],
        required: true
    },
    questions: [questionAttemptSchema],
    status: {
        type: String,
        enum: ['not_started', 'in_progress', 'completed'],
        default: 'not_started'
    },
    score: {
        type: Number,
        min: 0,
        max: 100
    },
    startedAt: Date,
    completedAt: Date,
    adaptationTrigger: {
        previousScore: Number,
        weakAreas: [String],
        recommendedLevel: Number
    }
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
        strengths: [{
            topic: String,
            bloomLevel: Number,
            demonstratedSkills: [String]
        }],
        weakAreas: [{
            topic: String,
            bloomLevel: Number,
            detectedIssues: [String],
            recommendedFocus: String
        }]
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
    newQuestionSetId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    newFlashcardIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Summary'
    }]
});

const chapterProgressSchema = new mongoose.Schema({
    chapterIndex: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['not_started', 'in_progress', 'completed'],
        default: 'not_started'
    },
    currentQuestionSetIndex: {
        type: Number,
        default: 0
    },
    questionSets: [questionSetProgressSchema],
    masteredLevels: [{
        bloomLevel: Number,
        masteredAt: Date
    }],
    comprehensionScore: {
        type: Number,
        min: 0,
        max: 100
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
        },
        currentQuestionSetId: {
            type: mongoose.Schema.Types.ObjectId
        }
    },
    chapterProgress: [chapterProgressSchema],
    adaptiveHistory: [adaptiveHistorySchema],
    learningPath: {
        recommendedOrder: [Number],
        currentPosition: Number,
        lastUpdated: Date
    },
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

ModuleInstanceSchema.index({ userId: 1, moduleMasterId: 1 }, { unique: true });
ModuleInstanceSchema.index({ status: 1 });
ModuleInstanceSchema.index({ lastAccessedAt: -1 });

module.exports = {
    ModuleInstance: mongoose.model('ModuleInstance', ModuleInstanceSchema)
};