const express = require('express');
const router = express.Router();
const multer = require('multer');
const { asyncHandler } = require('../middlewares/errorHandler');
const userController = require('../controllers/userController');
const authenticate = require('../middlewares/authMiddleware');

// Configure multer for image uploads
const upload = multer({
    storage: multer.diskStorage({
        destination: function (req, file, cb) {
            cb(null, './uploads')
        },
        filename: function (req, file, cb) {
            cb(null, Date.now() + '-' + file.originalname)
        }
    }),
    fileFilter: function (req, file, cb) {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true)
        } else {
            cb(new Error('Not an image! Please upload an image.'), false)
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});
router.get('/profile', authenticate, asyncHandler(userController.getProfile.bind(userController)));
// User Routes
router.post('/', asyncHandler(userController.createUser.bind(userController)));
router.get('/:userId', authenticate, asyncHandler(userController.getUser.bind(userController)));
router.put('/:userId', authenticate,
    upload.single('image'),
    asyncHandler(userController.updateUser.bind(userController))
);

router.post('/login', asyncHandler(userController.login.bind(userController)));
router.post('/register', asyncHandler(userController.register.bind(userController)));

module.exports = router;