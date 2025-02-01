// src/routes/moduleRoutes.js
const express = require('express');
const router = express.Router();
const upload = require('../config/multer');
const { asyncHandler } = require('../middlewares/errorHandler');
const moduleController = require('../controllers/moduleController');

// Module Master Routes
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

// Chapter Generation Routes
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

router.get('/instance/:instanceId',
  asyncHandler(moduleController.getInstanceProgress)
);

// Assessment Routes
router.post('/instance/:instanceId/submit',
  asyncHandler(moduleController.submitAssessment)
);

router.get('/instance/:instanceId/next-questions',
  asyncHandler(moduleController.getNextQuestions)
);

module.exports = router;