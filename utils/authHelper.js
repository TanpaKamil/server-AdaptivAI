const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { AppError } = require('../middlewares/errorHandler');

class AuthHelper {
  async hashPassword(password) {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    return hashedPassword;
  }

  async comparePassword(password, hashedPassword) {
    const match = await bcrypt.compare(password, hashedPassword);
    return match;
  }

  generateToken(payload) {
    const secretKey = process.env.JWT_SECRET_KEY;
    const token = jwt.sign(payload, secretKey);
    return token;
  }

  verifyToken(token) {
    try {
      const secretKey = process.env.JWT_SECRET_KEY;
      const decoded = jwt.verify(token, secretKey);
      return decoded;
    } catch (error) {
      throw new AppError('Invalid token', 401);
    }
  }
}

module.exports = new AuthHelper();