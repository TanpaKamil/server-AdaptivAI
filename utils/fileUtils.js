const fs = require('fs');
const { promisify } = require('util');
const unlinkAsync = promisify(fs.unlink);

const cleanupFile = async (filePath) => {
    if (!filePath) {
        console.log('No file path provided for cleanup');
        return;
    }

    try {
        // Check if file exists before attempting to delete
        const exists = await promisify(fs.access)(filePath)
            .then(() => true)
            .catch(() => false);

        if (!exists) {
            console.log(`File does not exist: ${filePath}`);
            return;
        }

        await unlinkAsync(filePath);
        console.log(`Successfully deleted local file: ${filePath}`);
    } catch (error) {
        console.error(`Error deleting local file: ${filePath}`, error);
        // Don't throw the error as this is a cleanup operation
    }
};

module.exports = {
    cleanupFile
};