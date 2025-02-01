const axios = require('axios');

async function analyzeContent(content) {
    try {
        // Run both analyses in parallel
        const [huggingfaceResult, mistralResult] = await Promise.all([
            axios.post('https://api-inference.huggingface.co/models/fakenews-detector', 
                { inputs: content },
                { headers: { Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}` } }
            ),
            axios.post('https://api.mistral.ai/v1/chat/completions',
                {
                    model: "mistral-small",
                    messages: [
                        {
                            role: "system",
                            content: "Analyze the following content for credibility and factuality."
                        },
                        {
                            role: "user",
                            content: content
                        }
                    ]
                },
                { headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}` } }
            )
        ]);

        return {
            huggingface: huggingfaceResult.data,
            mistral: mistralResult.data,
            combined: combineAnalysis(huggingfaceResult.data, mistralResult.data)
        };
    } catch (error) {
        return { error: "Analysis failed", details: error.message };
    }
}

function combineAnalysis(hfResult, mistralResult) {
    // Implement combination logic here
    return {
        credibilityScore: (hfResult.score * 0.6) + (mistralResult.score * 0.4),
        confidence: Math.round((hfResult.confidence + mistralResult.confidence) / 2)
    };
}

module.exports = analyzeContent;
