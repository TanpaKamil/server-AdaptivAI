const express = require('express');
const router = express.Router();
const upload = require('../config/multer');
const { asyncHandler } = require('../middlewares/errorHandler');
const ModuleController = require('../controllers/moduleController');
const authenticate = require('../middlewares/authMiddleware');

const moduleController = new ModuleController();

// ------------------------
// Public Module Routes
// ------------------------
router.get('/pub/featured',
    asyncHandler(moduleController.getFeaturedPublicModules.bind(moduleController))
);

router.get('/pub/recommendation',
    asyncHandler(moduleController.getRecommendedPublicModules.bind(moduleController))
);

router.get('/pub',
    asyncHandler(moduleController.getAllPublicModules.bind(moduleController))
);

router.get('/pub/:moduleId',
    asyncHandler(moduleController.getPublicModuleById.bind(moduleController))
);

router.post('/pub/:moduleId',
    asyncHandler(moduleController.startModuleInstance.bind(moduleController))
);

// ------------------------
// Module Instance Routes
// ------------------------
router.get('/instances',
    asyncHandler(moduleController.getUserInstances.bind(moduleController))
)

router.get('/instances/:instanceId',
    asyncHandler(moduleController.getInstanceProgress.bind(moduleController))
);

// Assessment Routes
router.post('/instances/:instanceId/assessment',
    asyncHandler(moduleController.submitAssessment.bind(moduleController))
);

router.get('/instances/:instanceId/assessment',
    asyncHandler(moduleController.getNextQuestions.bind(moduleController))
);

router.put('/instances/:instanceId/assessment',
    asyncHandler(moduleController.updateAssessmentAnswer.bind(moduleController))
);

// Instance Chapter Routes
router.get('/instances/:instanceId/chapters/:chapterId',
    asyncHandler(moduleController.getChapter.bind(moduleController))
);

router.get('/instances/:instanceId/chapters/:chapterId/levels',
    asyncHandler(moduleController.getLevels.bind(moduleController))
);

router.get('/instances/:instanceId/chapters/:chapterId/feedbacks',
    asyncHandler(moduleController.getFeedbacks.bind(moduleController))
);


// ------------------------
// Module Master Routes
// ------------------------
// Create new module (should be before param routes)
router.post('/',
    upload.single('pdf'),
    asyncHandler(moduleController.createModule.bind(moduleController))
);

// Get all modules
router.get('/',
    asyncHandler(moduleController.getAllModules.bind(moduleController))
);

// Module-specific routes
router.get('/:moduleId',
    asyncHandler(moduleController.getModuleById.bind(moduleController))
);

router.post('/:moduleId/start',
    asyncHandler(moduleController.startModuleInstance.bind(moduleController))
);

// Module Chapter Routes
router.post('/:moduleId/chapters/:chapterId/generate',
    asyncHandler(moduleController.generateChapterContent.bind(moduleController))
);

router.get('/:moduleId/chapters/:chapterId',
    asyncHandler(moduleController.getChapterContent.bind(moduleController))
);

module.exports = router;