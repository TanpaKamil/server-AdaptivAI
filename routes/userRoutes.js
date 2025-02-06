const express = require('express');
const router = express.Router();
const multer = require('multer');
const { asyncHandler } = require('../middlewares/errorHandler');
const userController = require('../controllers/userController');
const authenticate = require('../middlewares/authMiddleware');
const path = require('path');

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, './uploads')
    },
    filename: function (req, file, cb) {
        // Gunakan extension file asli
        const ext = path.extname(file.originalname);
        cb(null, `image-${Date.now()}${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    // Cek tipe MIME untuk memastikan hanya file gambar yang diterima
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Please upload an image file (JPEG, PNG, etc).'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

router.get('/profile', authenticate, asyncHandler(userController.getProfile.bind(userController)));
router.post('/', asyncHandler(userController.createUser.bind(userController)));
router.get('/:userId', authenticate, asyncHandler(userController.getUser.bind(userController)));
router.put('/:userId',
    authenticate,
    upload.single('image'),
    asyncHandler(userController.updateUser.bind(userController))
);

router.post('/login', asyncHandler(userController.login.bind(userController)));
router.post('/register', asyncHandler(userController.register.bind(userController)));

module.exports = router;