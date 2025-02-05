// tests/helpers/testUtils.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

module.exports = {
    generateAuthToken: (userId) => {
        return jwt.sign(
            { id: userId }, 
            process.env.JWT_SECRET_KEY || 'test-secret',
            { expiresIn: '1h' }
        );
    },
    
    createAuthHeader: (token) => ({
        'Authorization': `Bearer ${token}`
    }),

    hashPassword: async (password) => {
        return await bcrypt.hash(password, 10);
    },

    createTestUser: async (User, userData) => {
        const hashedPassword = await bcrypt.hash(userData.password, 10);
        const user = await User.create({
            ...userData,
            password: hashedPassword
        });
        return user;
    }
};