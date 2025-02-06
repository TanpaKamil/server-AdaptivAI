const mongoose = require('mongoose');

// Like Schema
const likeSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    username: {
        type: String,
        required: true
    }
}, {
    timestamps: true,
    _id: true // Ensure _id is generated for likes
});

// Comment Schema
const commentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    username: {
        type: String,
        required: true
    },
    content: {
        type: String,
        required: true
    }
}, {
    timestamps: true,
    _id: true // Ensure _id is generated for comments
});

// Discussion Schema
const discussionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    content: {
        type: String,
        required: true
    },
    imgUrl: {
        type: String,
        trim: true
    },
    comments: [commentSchema],
    likes: [likeSchema]
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual for comments length
discussionSchema.virtual('comments_length').get(function() {
    return Array.isArray(this.comments) ? this.comments.length : 0;
});

// Virtual for likes length
discussionSchema.virtual('likes_length').get(function() {
    return Array.isArray(this.likes) ? this.likes.length : 0;
});

// Ensure virtuals are included when converting to JSON
discussionSchema.set('toJSON', {
    virtuals: true,
    transform: function(doc, ret) {
        ret.id = ret._id;
        return ret;
    }
});

// Add indexes for better query performance
discussionSchema.index({ userId: 1, createdAt: -1 });
discussionSchema.index({ createdAt: -1 });

const Discussion = mongoose.model('Discussion', discussionSchema);

module.exports = Discussion;