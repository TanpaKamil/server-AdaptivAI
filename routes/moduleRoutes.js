const express = require('express');
const router = express.Router();
const upload = require('../config/multer');
const { asyncHandler } = require('../middlewares/errorHandler');
const moduleController = require('../controllers/moduleController');

// Add debug middleware
router.use((req, res, next) => {
    console.log(`ModuleRoutes - Path: ${req.path}`);
    console.log(`ModuleRoutes - Method: ${req.method}`);
    next();
});

// Chapter Generation Routes - Move these above the more generic routes
router.post('/:moduleId/chapters/:chapterId/generate',
    asyncHandler(moduleController.generateChapterContent)
);

router.get('/:moduleId/chapters/:chapterId',
    asyncHandler(moduleController.getChapterContent)
);

// Module Instance Routes
router.post('/:moduleId/start',
    asyncHandler(moduleController.startModuleInstance)
);

// Move instance routes before the generic moduleId route
router.get('/instance/:instanceId',
    asyncHandler(moduleController.getInstanceProgress)
);

router.post('/instance/:instanceId/submit',
    asyncHandler(moduleController.submitAssessment)
);

router.get('/instance/:instanceId/next-questions',
    asyncHandler(moduleController.getNextQuestions)
);

// Generic module routes at the end
router.post('/upload', 
    upload.single('pdf'),
    asyncHandler(moduleController.createModule)
);

router.get('/',
    asyncHandler(moduleController.getAllModules)
);

router.get('/:moduleId',
    asyncHandler(moduleController.getModuleById)
);

module.exports = router;