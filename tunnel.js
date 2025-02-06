const ngrok = require('ngrok');
require('dotenv').config();

const startTunnel = async (port) => {
    try {
        const url = await ngrok.connect({
            addr: port,
            // Optional: add your authtoken for more features
            // authtoken: process.env.NGROK_AUTH_TOKEN,
        });
        console.log('🚇 Ngrok tunnel created:', url);
        console.log(`📚 API Documentation available at ${url}/api-docs`);
    } catch (error) {
        console.error('Error creating ngrok tunnel:', error);
    }
};

module.exports = startTunnel;