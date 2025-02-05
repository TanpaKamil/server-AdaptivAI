module.exports = {
    testEnvironment: 'node',
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
    testMatch: ['**/tests/**/*.test.js'],
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/tests/setup.js',
        '/tests/fixtures/'
    ],
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1'
    },
    "testTimeout": 30000
};