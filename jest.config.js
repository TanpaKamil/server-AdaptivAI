module.exports = {
    collectCoverage: true,
    coverageReporters: ['text', 'lcov'],
    collectCoverageFrom: [
        '**/*.{js,jsx}',
        '!**/node_modules/**',
        '!**/coverage/**'
    ],
    coveragePathIgnorePatterns: [
        '/tunnel.js',
        '/node_modules/',
        '/config/gemini.js',
        'config/db.js',
        '/middlewares/errorHandler.js',
        '/controllers/moduleController.js',
        '/services/moduleService.js',
        '/utils/aiResponseHelper.js',
        '/models/ModuleMaster.js',
        'routes/moduleRoutes.js',
        'jest.config.js',
        'routes/index.js',
        'server.js',
        'app.js',
    ],
    testEnvironment: 'node',
    verbose: true
};