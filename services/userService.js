const User = require('../models/User');
const { AppError } = require('../middlewares/errorHandler');

class UserService {
    async createUser(userData) {
        try {
            const newUser = await User.create(userData);
            return newUser;
        } catch (error) {
            // Handle unique constraint violations
            if (error.code === 11000) {
                if (error.keyPattern.username) {
                    throw new AppError('Username already exists', 400);
                } else if (error.keyPattern.email) {
                    throw new AppError('Email already exists', 400);
                }
            }
            throw new AppError('Failed to create user', 500);
        }
    }

    async getUserById(userId) {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new AppError('User not found', 404);
            }
            return user;
        } catch (error) {
            throw new AppError('Failed to get user', 500);
        }
    }

    async updateUser(userId, updateData) {
        try {
            const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
                new: true,
                runValidators: true
            });
            if (!updatedUser) {
                throw new AppError('User not found', 404);
            }
            return updatedUser;
        } catch (error) {
            // Handle unique constraint violations
            if (error.code === 11000) {
                if (error.keyPattern.username) {
                    throw new AppError('Username already exists', 400);
                } else if (error.keyPattern.email) {
                    throw new AppError('Email already exists', 400);
                }
            }
            throw new AppError('Failed to update user', 500);
        }
    }

    async getUserByEmail(email) {
        try {
            const user = await User.findOne({ email });
            if (!user) {
                throw new AppError('User not found', 404);
            }
            return user;
        } catch (error) {
            throw new AppError('Failed to get user by email', 500);
        }
    }

    // Add more methods as needed (e.g., deleteUser, changePassword)
}

module.exports = new UserService();