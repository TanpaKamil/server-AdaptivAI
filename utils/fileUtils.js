const fs = require('fs');
const { promisify } = require('util');
const unlinkAsync = promisify(fs.unlink);

const cleanupFile = async (filePath) => {
    try {
        await unlinkAsync(filePath);
        console.log(`Successfully deleted local file: ${filePath}`);
    } catch (error) {
        console.error(`Error deleting local file: ${filePath}`, error);
    }
};

module.exports = {
    cleanupFile
};