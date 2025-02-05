const userService = require('../services/userService');
const authHelper = require('../utils/authHelper');
const { uploadToCloudinary, cloudinary } = require('../config/cloudinary');
const { cleanupFile } = require('../utils/fileUtils');
const { asyncHandler } = require('../middlewares/errorHandler');

class UserController {
    // Create a new user
    async createUser(req, res) {
        const userData = req.body;
        userData.password = await authHelper.hashPassword(userData.password); // Hash password
        const newUser = await userService.createUser(userData);
        res.status(201).json({
            status: 'success',
            data: { user: newUser }
        });
    }

    // Login user
    async login(req, res) {
        const { email, password } = req.body;

        const user = await userService.getUserByEmail(email); // Assuming you add this method to userService
        if (!user) {
            throw new AppError('Invalid email or password', 401);
        }

        const match = await authHelper.comparePassword(password, user.password);
        if (!match) {
            throw new AppError('Invalid email or password', 401);
        }

        // Generate JWT
        const token = authHelper.generateToken({ id: user._id, username: user.username });

        res.status(200).json({
            status: 'success',
            data: { token }
        });
    }

    // Get user by ID
    async getUser(req, res) {
        const { userId } = req.params;
        const user = await userService.getUserById(userId);
        res.status(200).json({
            status: 'success',
            data: { user }
        });
    }

    // Update user
    async updateUser(req, res) {
        const { userId } = req.params;
        const updateData = { ...req.body };
        let cloudinaryResult = null;
        let localFilePath = null;

        try {
            // Check if user exists
            const existingUser = await User.findById(userId);
            if (!existingUser) {
                throw new AppError('User not found', 404);
            }

            // Handle image upload if present
            if (req.file) {
                localFilePath = req.file.path;

                try {
                    // Upload to Cloudinary
                    cloudinaryResult = await uploadToCloudinary(localFilePath);
                    if (!cloudinaryResult || !cloudinaryResult.secure_url) {
                        throw new AppError('Failed to upload image', 500);
                    }
                    updateData.imageUrl = cloudinaryResult.secure_url;

                    // Delete old image from Cloudinary if exists
                    if (existingUser.imageUrl) {
                        const oldPublicId = existingUser.imageUrl.split('/').pop().split('.')[0];
                        await cloudinary.uploader.destroy(oldPublicId);
                    }
                } catch (uploadError) {
                    console.error('Cloudinary upload error:', uploadError);
                    throw new AppError('Failed to upload image: ' + uploadError.message, 500);
                }
            }

            // Handle password update if present
            if (updateData.password) {
                updateData.password = await authHelper.hashPassword(updateData.password);
            }

            // Update user data
            const updatedUser = await User.findByIdAndUpdate(
                userId,
                updateData,
                { new: true, runValidators: true }
            ).select('-password'); // Exclude password from response

            // Cleanup local file
            if (localFilePath) {
                await cleanupFile(localFilePath);
            }

            res.status(200).json({
                status: 'success',
                data: { user: updatedUser }
            });

        } catch (error) {
            // Cleanup on error
            if (localFilePath) {
                await cleanupFile(localFilePath);
            }
            if (cloudinaryResult?.public_id) {
                await cloudinary.uploader.destroy(cloudinaryResult.public_id);
            }

            // Handle specific errors
            if (error.code === 11000) {
                if (error.keyPattern.username) {
                    throw new AppError('Username already exists', 400);
                } else if (error.keyPattern.email) {
                    throw new AppError('Email already exists', 400);
                }
            }
            throw new AppError(error.message, error.statusCode || 500);
        }
    }

    async register(req, res) {
        const userData = req.body;
        userData.password = await authHelper.hashPassword(userData.password); // Hash password
        await userService.createUser(userData);
        res.status(201).json({
            status: 'success',
            message: 'Registration successful'
        });
    }


    // Add more methods as needed (e.g., deleteUser, changePassword)
}

module.exports = new UserController();