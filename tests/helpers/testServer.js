// tests/helpers/testServer.js
const app = require('../../app');  // Adjust path based on your structure
const supertest = require('supertest');

const testServer = supertest(app);

module.exports = testServer;