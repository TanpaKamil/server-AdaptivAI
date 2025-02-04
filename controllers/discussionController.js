const Discussion = require('../models/Discussion');
const { AppError } = require('../middlewares/errorHandler');
const { cleanupFile } = require('../utils/fileUtils');  // Add this import
const { uploadToCloudinary } = require('../config/cloudinary'); // Make sure this is also imported


class DiscussionController {
    // Get all discussions
    async getAllDiscussions(req, res) {
        const discussions = await Discussion.find()
            .select('title content imgUrl comments_length likes_length')
            .sort('-createdAt');

        res.status(200).json(discussions);
    }

    async createDiscussion(req, res) {
        const userId = req.user.id;
        let cloudinaryResult = null;
        let localFilePath = null;

        try {
            if (!req.body.title || !req.body.content) {
                throw new AppError('Title and content are required', 400);
            }

            if (req.file) {
                localFilePath = req.file.path;
                cloudinaryResult = await uploadToCloudinary(localFilePath, 'image');
            }

            const discussion = await Discussion.create({
                userId,
                title: req.body.title,
                content: req.body.content,
                imgUrl: cloudinaryResult?.secure_url || null
            });

            if (localFilePath) await cleanupFile(localFilePath);

            res.status(201).json({ message: "create" });
        } catch (error) {
            if (localFilePath) await cleanupFile(localFilePath);
            throw error;
        }
    }

    // Get discussion detail
    async getDiscussionDetail(req, res) {
        const { discussionId } = req.params;

        const discussion = await Discussion.findById(discussionId)
            .populate('userId', 'username')
            .populate('comments.userId', 'username')
            .populate('likes.userId', 'username');

        if (!discussion) {
            throw new AppError('Discussion not found', 404);
        }

        res.status(200).json(discussion);
    }

    // Update discussion
    async updateDiscussion(req, res) {
        const { discussionId } = req.params;
        const { title, content } = req.body;
        const userId = req.user.id;
        let cloudinaryResult = null;
        let localFilePath = null;

        const discussion = await Discussion.findById(discussionId);

        if (!discussion) {
            throw new AppError('Discussion not found', 404);
        }

        if (discussion.userId.toString() !== userId) {
            throw new AppError('Not authorized to edit this discussion', 403);
        }

        try {
            // Handle image upload if present
            if (req.file) {
                localFilePath = req.file.path;

                try {
                    // Upload to Cloudinary
                    cloudinaryResult = await uploadToCloudinary(localFilePath, 'image');
                    if (!cloudinaryResult || !cloudinaryResult.secure_url) {
                        throw new AppError('Failed to upload image', 500);
                    }
                } catch (uploadError) {
                    console.error('Cloudinary upload error:', uploadError);
                    if (localFilePath) await cleanupFile(localFilePath);
                    throw new AppError('Failed to upload image: ' + uploadError.message, 500);
                }
            }

            const updateData = {
                title,
                content,
                ...(cloudinaryResult?.secure_url && { imgUrl: cloudinaryResult.secure_url })
            };

            await Discussion.findByIdAndUpdate(discussionId, updateData);

            // Cleanup local file
            if (localFilePath) {
                await cleanupFile(localFilePath);
            }

            res.status(200).json({
                message: "Topic has been edited"
            });
        } catch { }
    }

    // Delete discussion
    async deleteDiscussion(req, res) {
        const { discussionId } = req.params;
        const userId = req.user.id;

        const discussion = await Discussion.findById(discussionId);

        if (!discussion) {
            throw new AppError('Discussion not found', 404);
        }

        if (discussion.userId.toString() !== userId) {
            throw new AppError('Not authorized to delete this discussion', 403);
        }

        await Discussion.findByIdAndDelete(discussionId);

        res.status(200).json({
            message: "Topic has been deleted"
        });
    }

    // Add like
    async addLike(req, res) {
        const { discussionId } = req.params;
        const userId = req.user.id;
        const username = req.user.username;

        const discussion = await Discussion.findById(discussionId);

        if (!discussion) {
            throw new AppError('Discussion not found', 404);
        }

        // Check if user already liked
        if (discussion.likes.some(like => like.userId.toString() === userId)) {
            throw new AppError('Already liked this discussion', 400);
        }

        discussion.likes.push({ userId, username });
        await discussion.save();

        res.status(200).json({
            message: "Successfully liked topic"
        });
    }

    // Remove like
    async removeLike(req, res) {
        const { discussionId, likesId } = req.params;
        const userId = req.user.id;

        const discussion = await Discussion.findById(discussionId);

        if (!discussion) {
            throw new AppError('Discussion not found', 404);
        }

        const likeIndex = discussion.likes.findIndex(
            like => like._id.toString() === likesId && like.userId.toString() === userId
        );

        if (likeIndex === -1) {
            throw new AppError('Like not found or not authorized', 404);
        }

        discussion.likes.splice(likeIndex, 1);
        await discussion.save();

        res.status(200).json({
            message: "Successfully unlike topic"
        });
    }

    // Add comment
    async addComment(req, res) {
        const { discussionId } = req.params;
        const { content } = req.body;
        const userId = req.user.id;
        const username = req.user.username;

        const discussion = await Discussion.findById(discussionId);

        if (!discussion) {
            throw new AppError('Discussion not found', 404);
        }

        discussion.comments.push({
            userId,
            username,
            content
        });

        await discussion.save();

        res.status(200).json({
            message: "Comment has been added"
        });
    }

    // Delete comment
    async deleteComment(req, res) {
        const { discussionId, commentId } = req.params;
        const userId = req.user.id;

        const discussion = await Discussion.findById(discussionId);

        if (!discussion) {
            throw new AppError('Discussion not found', 404);
        }

        const commentIndex = discussion.comments.findIndex(
            comment => comment._id.toString() === commentId && comment.userId.toString() === userId
        );

        if (commentIndex === -1) {
            throw new AppError('Comment not found or not authorized', 404);
        }

        discussion.comments.splice(commentIndex, 1);
        await discussion.save();

        res.status(200).json({
            message: "Comment has been deleted"
        });
    }
}

module.exports = new DiscussionController();