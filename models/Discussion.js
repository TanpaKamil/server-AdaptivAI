const mongoose = require('mongoose');

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
    timestamps: true
});

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
    },
    comments: {
        type: [this],
        default: []
    },
    likes: {
        type: [likeSchema],
        default: []
    }
}, {
    timestamps: true
});

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
    comments: {
        type: [commentSchema],
        default: []
    },
    likes: {
        type: [likeSchema],
        default: []
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

discussionSchema.virtual('comments_length').get(function() {
    return this.comments ? this.comments.length : 0;
});

discussionSchema.virtual('likes_length').get(function() {
    return this.likes ? this.likes.length : 0;
});

module.exports = mongoose.model('Discussion', discussionSchema);