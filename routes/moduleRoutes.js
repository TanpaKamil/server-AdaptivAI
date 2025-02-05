const express = require('express');
const router = express.Router();
const upload = require('../config/multer');
const { asyncHandler } = require('../middlewares/errorHandler');
const ModuleController = require('../controllers/moduleController');
const authenticate = require('../middlewares/authMiddleware');

const moduleController = new ModuleController();

// ------------------------
// Public Module Routes (No Auth Required)
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

// ------------------------
// Protected Routes (Auth Required)
// ------------------------

//dashboard module
router.get('/dashboard',
    authenticate,
    asyncHandler(moduleController.getDashboardModules.bind(moduleController))
);

// Public Module Routes that need auth
router.post('/pub/:moduleId',
    authenticate,
    asyncHandler(moduleController.startModuleInstance.bind(moduleController))
);

// Module Instance Routes
router.get('/instances',
    authenticate,
    asyncHandler(moduleController.getUserInstances.bind(moduleController))
);

router.get('/instances/:instanceId',
    authenticate,
    asyncHandler(moduleController.getInstanceProgress.bind(moduleController))
);

// Assessment Routes
router.post('/instances/:instanceId/assessment',
    authenticate,
    asyncHandler(moduleController.submitAssessment.bind(moduleController))
);

router.get('/instances/:instanceId/assessment',
    authenticate,
    asyncHandler(moduleController.getNextQuestions.bind(moduleController))
);

router.put('/instances/:instanceId/assessment',
    authenticate,
    asyncHandler(moduleController.updateAssessmentAnswer.bind(moduleController))
);

// Instance Chapter Routes
router.get('/instances/:instanceId/chapters/:chapterId',
    authenticate,
    asyncHandler(moduleController.getChapter.bind(moduleController))
);

router.get('/instances/:instanceId/chapters/:chapterId/levels',
    authenticate,
    asyncHandler(moduleController.getLevels.bind(moduleController))
);

router.get('/instances/:instanceId/chapters/:chapterId/feedbacks',
    authenticate,
    asyncHandler(moduleController.getFeedbacks.bind(moduleController))
);

// In moduleRoutes.js
router.get('/instances/:instanceId/chapters/:chapterId/questions/:questionId',
    authenticate,
    asyncHandler(moduleController.getQuestionDetail.bind(moduleController))
);

// Module Master Routes
router.post('/',
    authenticate,
    upload.single('pdf'),
    asyncHandler(moduleController.createModule.bind(moduleController))
);

router.get('/',
    authenticate,
    asyncHandler(moduleController.getAllModules.bind(moduleController))
);

router.get('/:moduleId',
    authenticate,
    asyncHandler(moduleController.getModuleById.bind(moduleController))
);

router.post('/:moduleId/start',
    authenticate,
    asyncHandler(moduleController.startModuleInstance.bind(moduleController))
);

router.post('/:moduleId/chapters/:chapterId/generate',
    authenticate,
    asyncHandler(moduleController.generateChapterContent.bind(moduleController))
);

router.get('/:moduleId/chapters/:chapterId',
    authenticate,
    asyncHandler(moduleController.getChapterContent.bind(moduleController))
);

module.exports = router;