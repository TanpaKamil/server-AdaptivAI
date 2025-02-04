// src/routes/discussionRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const discussionController = require('../controllers/discussionController');
const authenticate = require('../middlewares/authMiddleware');
const { asyncHandler } = require('../middlewares/errorHandler');

// Configure multer for discussion image uploads
const upload = multer({
    storage: multer.diskStorage({
        destination: function (req, file, cb) {
            cb(null, './uploads')
        },
        filename: function (req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, 'discussion-' + uniqueSuffix + '-' + file.originalname)
        }
    }),
    fileFilter: function (req, file, cb) {
        // Accept only image files
        if (file.mimetype.startsWith('image/')) {
            cb(null, true)
        } else {
            cb(new Error('Only image files (jpeg, png, gif) are allowed'), false)
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// All routes require authentication
router.use(authenticate);

// Get all discussions
router.get('/', asyncHandler(discussionController.getAllDiscussions));

// Create new discussion
router.post('/', upload.single('image'), asyncHandler(discussionController.createDiscussion));

// Get discussion detail
router.get('/:discussionId', asyncHandler(discussionController.getDiscussionDetail));

// Update discussion
router.put('/:discussionId', upload.single('image'), asyncHandler(discussionController.updateDiscussion));

// Delete discussion
router.delete('/:discussionId', asyncHandler(discussionController.deleteDiscussion));

// Likes routes
router.patch('/:discussionId/likes', asyncHandler(discussionController.addLike));
router.delete('/:discussionId/likes/:likesId', asyncHandler(discussionController.removeLike));

// Comments routes
router.patch('/:discussionId/comments', asyncHandler(discussionController.addComment));
router.delete('/:discussionId/comments/:commentId', asyncHandler(discussionController.deleteComment));

module.exports = router;