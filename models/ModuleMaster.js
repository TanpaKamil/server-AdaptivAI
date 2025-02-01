// src/models/ModuleMaster.js
const mongoose = require('mongoose');

const userAttemptSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    isCorrect: {
        type: Boolean,
        required: true
    },
    attemptedAt: {
        type: Date,
        default: Date.now
    }
});

const questionSchema = new mongoose.Schema({
    question: {
        type: String,
        required: true
    },
    options: [{
        type: String,
        required: true
    }],
    correctAnswer: {
        type: Number,
        required: true
    },
    explanation: {
        type: String,
        required: true
    },
    bloomLevel: {
        type: Number,
        required: true,
        min: 1,
        max: 6
    },
    usersAttempted: [userAttemptSchema]
});

const levelSchema = new mongoose.Schema({
    bloomLevel: {
        type: Number,
        required: true,
        min: 1,
        max: 6
    },
    questions: [questionSchema]
});

const summarySchema = new mongoose.Schema({
    content: {
        type: String,
        required: true
    },
    comprehensionLevel: {
        type: Number,
        required: true,
        min: 1,
        max: 6
    },
    flashcardFront: {
        type: String,
        required: true
    },
    flashcardBack: {
        type: String,
        required: true
    }
});

const chapterSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    order: {
        type: Number,
        required: true
    },
    excerpt: {
        type: String,
        required: true
    },
    summaries: [summarySchema],
    levels: [levelSchema]
});

const cacheSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    cacheName: {
        type: String,
        required: true
    },
    expiresAt: {
        type: Date,
        required: true
    }
});

const metadataSchema = new mongoose.Schema({
    caches: {
        type: [cacheSchema],
        default: []
    }
});

const ModuleMasterSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        index: true
    },
    description: {
        type: String,
        required: true
    },
    excerpt: {
        type: String,
        required: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },
    chapters: [chapterSchema],
    subscribedUsers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    isRecommended: {
        type: Boolean,
        default: false
    },
    metadata: {
        type: metadataSchema,
        default: () => ({
            caches: []
        })
    },
    pdfUrl: {
        type: String,
        required: true
    }
}, {
    timestamps: true
});

// Indexes
ModuleMasterSchema.index({ createdAt: -1 });
ModuleMasterSchema.index({ isRecommended: 1 });

module.exports = {
    ModuleMaster: mongoose.model('ModuleMaster', ModuleMasterSchema)
};