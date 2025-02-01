const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
} = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");

class GeminiConfig {
    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY;
        this.genAI = new GoogleGenerativeAI(this.apiKey);
        this.fileManager = new GoogleAIFileManager(this.apiKey);

        this.model = this.genAI.getGenerativeModel({
            model: "gemini-2.0-flash-exp",
        });

        this.generationConfig = {
            temperature: 1,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
        };
    }

    async uploadFile(path, mimeType) {
        try {
            const uploadResult = await this.fileManager.uploadFile(path, {
                mimeType,
                displayName: path,
            });
            console.log(`Uploaded file ${uploadResult.file.displayName} as: ${uploadResult.file.name}`);
            return uploadResult.file;
        } catch (error) {
            console.error('Error uploading file to Gemini:', error);
            throw error;
        }
    }

    async waitForFilesActive(files) {
        console.log("Waiting for file processing...");
        for (const name of files.map((file) => file.name)) {
            let file = await this.fileManager.getFile(name);
            while (file.state === "PROCESSING") {
                process.stdout.write(".");
                await new Promise((resolve) => setTimeout(resolve, 10_000));
                file = await this.fileManager.getFile(name);
            }
            if (file.state !== "ACTIVE") {
                throw Error(`File ${file.name} failed to process`);
            }
        }
        console.log("...all files ready\n");
        return true;
    }

    startChat(files = []) {
        return this.model.startChat({
            generationConfig: this.generationConfig,
            history: [],
        });
    }
}

module.exports = new GeminiConfig();
