const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const uploadToCloudinary = async (filePath, type = 'raw') => {
    try {
        const options = {
            folder: 'adaptive-learning',
            public_id: `${type}-${Date.now()}`
        };

        if (type === 'image') {
            options.resource_type = 'image';
        } else {
            options.resource_type = 'raw';
            options.format = 'pdf';
        }

        const result = await cloudinary.uploader.upload(filePath, options);
        return result;
    } catch (error) {
        console.error('Error uploading to Cloudinary:', error);
        throw error;
    }
};

module.exports = {
    cloudinary,
    uploadToCloudinary
};