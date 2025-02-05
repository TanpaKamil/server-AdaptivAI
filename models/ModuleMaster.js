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
        required: [true, 'Question text is required']
    },
    options: {
        type: [{
            type: String,
            required: [true, 'Option text is required']
        }],
        validate: {
            validator: function (arr) {
                return arr.length === 4;  // Must have exactly 4 options
            },
            message: 'Questions must have exactly 4 options'
        },
        required: [true, 'Options are required']
    },
    correctAnswer: {
        type: Number,
        required: [true, 'Correct answer index is required'],
        min: [0, 'Correct answer index must be between 0 and 3'],
        max: [3, 'Correct answer index must be between 0 and 3']
    },
    explanation: {
        type: String,
        required: [true, 'Explanation is required']
    },
    bloomLevel: {
        type: Number,
        required: [true, 'Bloom\'s taxonomy level is required'],
        min: [1, 'Bloom\'s level must be between 1 and 6'],
        max: [6, 'Bloom\'s level must be between 1 and 6'],
        validate: {
            validator: Number.isInteger,
            message: '{VALUE} is not an integer value for Bloom\'s level'
        }
    },
    difficultyLevel: {
        type: Number,
        required: [true, 'Difficulty level is required'],
        min: [1, 'Difficulty level must be between 1 and 5'],
        max: [5, 'Difficulty level must be between 1 and 5'],
        validate: {
            validator: Number.isInteger,
            message: '{VALUE} is not an integer value for difficulty level'
        }
    },
    learningObjective: {
        type: String,
        required: [true, 'Learning objective is required']
    },
    targetedConcept: {
        type: String,
        required: [true, 'Targeted concept is required']
    },
    metadata: {
        timeToAnswer: Number,  // in seconds
        averageScore: {
            type: Number,
            min: 0,
            max: 100
        },
        lastUpdated: {
            type: Date,
            default: Date.now
        }
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Add index for common queries
questionSchema.index({ bloomLevel: 1, difficultyLevel: 1 });

// Virtual for calculating success rate
questionSchema.virtual('successRate').get(function () {
    if (!this.metadata || typeof this.metadata.averageScore !== 'number') {
        return null;
    }
    return this.metadata.averageScore / 100;
});

// Method to validate question completeness
questionSchema.methods.isComplete = function () {
    return this.question &&
        this.options &&
        this.options.length === 4 &&
        typeof this.correctAnswer === 'number' &&
        this.bloomLevel &&
        this.difficultyLevel;
};

// Method to validate if question is ready for student
questionSchema.methods.isReadyForStudent = function () {
    return this.isComplete() &&
        this.explanation &&
        this.learningObjective &&
        this.targetedConcept;
};

module.exports = questionSchema;

const questionSetSchema = new mongoose.Schema({
    setNumber: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        enum: ['initial', 'adaptive'],
        required: true
    },
    questionRefs: [{
        questionId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true
        },
        bloomLevel: {
            type: Number,
            required: true,
            min: 1,
            max: 6
        },
        targetedConcept: String
    }],
    bloomLevelDistribution: {
        level1: Number,
        level2: Number,
        level3: Number,
        level4: Number,
        level5: Number,
        level6: Number
    },
    adaptationMetadata: {  // Only for adaptive sets
        targetedWeakAreas: [String],
        learningProgression: String,
        recommendedStudyOrder: [String],
        previousSetScore: Number,
        adaptationReason: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
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
    },
    relatedConcepts: [String],  // New field
    practicePrompt: String,     // New field
    adaptiveFor: {              // New field
        weakArea: String,
        bloomLevel: Number,
        generatedAt: Date
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
    levels: [{
        bloomLevel: {
            type: Number,
            required: true,
            min: 1,
            max: 6
        },
        questions: [questionSchema]
    }],
    questionSets: [questionSetSchema]  // New field
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
        ref: 'User',
        required: true,
        index: true
    },
    pdfUrl: {
        type: String,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isFeatured: {
        type: Boolean,
        default: false
    },
    chapters: [chapterSchema],
    subscribedUsers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],

    // Add an actual field to store the count
    subscriberCount: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['processing', 'completed', 'error'],
        default: 'processing'
    },
    errorMessage: {
        type: String,
        default: null
    },
    processingError: {
        type: String,
        default: null
    },
    uniqueIdentifier: {
        type: String,
        required: true,
        unique: true,
        index: true
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Keep the virtual for backward compatibility
ModuleMasterSchema.virtual('subscribers').get(function () {
    // Return the stored count if available, otherwise calculate
    return this.subscriberCount || this.subscribedUsers.length;
});

// Middleware to update subscriberCount before saving
ModuleMasterSchema.pre('save', function (next) {
    if (this.isModified('subscribedUsers')) {
        this.subscriberCount = this.subscribedUsers.length;
    }
    next();
});

// Index for efficient sorting by popularity
ModuleMasterSchema.index({ subscriberCount: -1 });

ModuleMasterSchema.index({ createdBy: 1, uniqueIdentifier: 1 }, { unique: true });

// Helper methods for managing subscribers
ModuleMasterSchema.methods.addSubscriber = async function (userId) {
    if (!this.subscribedUsers.includes(userId)) {
        this.subscribedUsers.push(userId);
        this.subscriberCount = this.subscribedUsers.length;
        await this.save();
    }
};

ModuleMasterSchema.methods.removeSubscriber = async function (userId) {
    this.subscribedUsers = this.subscribedUsers.filter(id => !id.equals(userId));
    this.subscriberCount = this.subscribedUsers.length;
    await this.save();
};

// Static methods for querying
ModuleMasterSchema.statics.getPopularModules = function (limit = 10) {
    return this.find()
        .sort({ subscriberCount: -1 })
        .limit(limit);
};

ModuleMasterSchema.statics.searchModulesByPopularity = function (searchQuery, limit = 10) {
    return this.find({
        $text: { $search: searchQuery },
        isActive: true
    })
        .sort({ subscriberCount: -1 })
        .limit(limit);
};

// Add text index for search
ModuleMasterSchema.index({ title: 'text', description: 'text' });

module.exports = {
    ModuleMaster: mongoose.model('ModuleMaster', ModuleMasterSchema)
};