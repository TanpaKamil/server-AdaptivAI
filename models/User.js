const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        unique: true,
        trim: true,
        minlength: 3
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        match: /^\S+@\S+\.\S+$/
    },
    password: {
        type: String,
        required: function () {
            // Password hanya required saat membuat user baru
            return this.isNew;
        },
        minlength: [6, 'Password must be at least 6 characters']
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    imageUrl: {
        type: String,
        trim: true
    },
    modules: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ModuleInstance'
    }],
    lastActive: {
        type: Date,
        default: Date.now
    }
});

// Pre-save hook to set default values
userSchema.pre('save', async function (next) {
    if (this.isNew) {
        // Generate username from email if not provided
        if (!this.username) {
            this.username = this.email.split('@')[0];

            // If username is less than 3 characters, append random numbers
            while (this.username.length < 3) {
                this.username += Math.floor(Math.random() * 10);
            }
        }

        // Generate image placeholder URL
        this.imageUrl = `https://image.pollinations.ai/prompt/image-placeholder-for-${this.username}`;

        // Initialize empty modules array
        this.modules = [];
    }
    next();
});

module.exports = mongoose.model('User', userSchema);