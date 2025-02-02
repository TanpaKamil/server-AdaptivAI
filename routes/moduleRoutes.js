const express = require('express');
const router = express.Router();
const upload = require('../config/multer');
const { asyncHandler } = require('../middlewares/errorHandler');
const ModuleController = require('../controllers/moduleController');

// Create a single instance of the controller
const moduleController = new ModuleController();

// Add debug middleware
router.use((req, res, next) => {
    console.log(`ModuleRoutes - Path: ${req.path}`);
    console.log(`ModuleRoutes - Method: ${req.method}`);
    next();
});

// Chapter Generation Routes
router.post('/:moduleId/chapters/:chapterId/generate',
    asyncHandler(moduleController.generateChapterContent.bind(moduleController))
);

router.get('/:moduleId/chapters/:chapterId',
    asyncHandler(moduleController.getChapterContent.bind(moduleController))
);

// Module Instance Routes
router.post('/:moduleId/start',
    asyncHandler(moduleController.startModuleInstance.bind(moduleController))
);

// Instance routes
router.get('/instance/:instanceId',
    asyncHandler(moduleController.getInstanceProgress.bind(moduleController))
);

router.post('/instance/:instanceId/submit',
    asyncHandler(moduleController.submitAssessment.bind(moduleController))
);

router.get('/instance/:instanceId/next-questions',
    asyncHandler(moduleController.getNextQuestions.bind(moduleController))
);

// Generic module routes
router.post('/upload', 
    upload.single('pdf'),
    asyncHandler(moduleController.createModule.bind(moduleController))
);

router.get('/',
    asyncHandler(moduleController.getAllModules.bind(moduleController))
);

router.get('/:moduleId',
    asyncHandler(moduleController.getModuleById.bind(moduleController))
);

module.exports = router;