const axios = require('axios');

// At the top of the file, verify the API key is loaded
if (!process.env.HUGGINGFACE_API_KEY) {
    console.error('HUGGINGFACE_API_KEY is not set in environment variables');
    process.exit(1);
}

// Update the headers definition
const HUGGINGFACE_HEADERS = {
    'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
    'Content-Type': 'application/json'
};

// Add Mistral API configuration
const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_HEADERS = {
    'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
    'Content-Type': 'application/json'
};

// Verify both API keys are present
if (!process.env.HUGGINGFACE_API_KEY || !process.env.MISTRAL_API_KEY) {
    console.error('Missing required API keys');
    process.exit(1);
}

// Update the retry logic helper
const retryWithTimeout = async (apiCall, maxRetries = 3, timeout = 30000) => {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);
            
            const response = await apiCall(controller.signal);
            clearTimeout(id);
            return response;
        } catch (error) {
            lastError = error;
            console.log(`Attempt ${i + 1} failed:`, error.message);
            
            if (i < maxRetries - 1) {
                const delay = Math.min(1000 * Math.pow(2, i), 5000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    throw lastError;
};

const extractNewsSource = (content) => {
    // Enhanced news source patterns
    const sourcePatterns = [
        // Major news agencies and websites
        { 
            pattern: /(Reuters|Associated Press|AP|AFP|BBC News|CNN|Fox News|MSNBC|Al Jazeera|The New York Times|Washington Post|The Guardian|USA Today|Wall Street Journal|Bloomberg|NPR|CBC News|NBC News|ABC News|CBS News)/gi, 
            type: 'Major News Agency' 
        },
        // Social media platforms with better context
        { 
            pattern: /(?:reported|posted|shared|announced|stated|published|revealed|according to sources?) (?:on|via|through|in) (Twitter|Facebook|Instagram|LinkedIn|YouTube|TikTok|X|Thread)/gi, 
            type: 'Social Media' 
        },
        // News websites
        { 
            pattern: /(www\.|https?:\/\/)?([a-zA-Z0-9-]+\.)*(news|com|org|gov|edu)(\/[^\s]*)?/gi, 
            type: 'News Website' 
        },
        // Generic attribution patterns
        { 
            pattern: /(?:according to|as reported by|sources from|cited by|confirmed by|stated by|revealed by|announced by) ([^,.]+)/gi, 
            type: 'Cited Source' 
        },
        // Official sources
        { 
            pattern: /(?:officials from|spokesperson for|representatives of|statement from) ([^,.]+)/gi, 
            type: 'Official Source' 
        },
        // Local news sources
        { 
            pattern: /(?:local|regional|city|county|state) (?:news|media|press|reports|sources) ([^,.]+)/gi, 
            type: 'Local News' 
        }
    ];

    let sources = [];
    const processedSources = new Set(); // To avoid duplicates

    sourcePatterns.forEach(({ pattern, type }) => {
        const matches = content.matchAll(pattern);
        for (const match of matches) {
            let source = '';
            if (type === 'Major News Agency') {
                source = match[0];
            } else if (type === 'News Website') {
                source = match[0];
            } else {
                // For patterns with capturing groups
                source = match[1] || match[0];
            }
            
            // Clean up the source text
            source = source.replace(/^[\s,."']+|[\s,."']+$/g, '') // Remove punctuation and spaces
                         .replace(/(reported by|according to|sources from|reported on|posted on|via|through|in)/gi, '')
                         .trim();

            // Only add if it's not already processed and not empty
            if (source && !processedSources.has(source.toLowerCase())) {
                processedSources.add(source.toLowerCase());
                sources.push({ 
                    name: source,
                    type: type,
                    confidence: type === 'Major News Agency' ? 'High' : 
                              type === 'Official Source' ? 'High' :
                              type === 'News Website' ? 'Medium' : 'Low'
                });
            }
        }
    });

    // Sort sources by confidence
    sources.sort((a, b) => {
        const confidenceOrder = { 'High': 3, 'Medium': 2, 'Low': 1 };
        return confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
    });

    return sources;
};

// Keep the model configuration
const MODELS = {
    CLASSIFIER: 'facebook/bart-large-mnli'
};

// Add Mistral analysis function
async function analyzeMistral(content) {
    try {
        const response = await axios.post(
            MISTRAL_API_URL,
            {
                model: "mistral-small",
                messages: [
                    {
                        role: "system",
                        content: "You are a fact-checking assistant. Analyze the following content and provide a detailed assessment of its credibility, factuality, and potential biases. Return the result as a JSON object with scores and analysis."
                    },
                    {
                        role: "user",
                        content: content
                    }
                ],
                temperature: 0.1,
                response_format: { type: "json_object" }
            },
            {
                headers: MISTRAL_HEADERS
            }
        );

        return JSON.parse(response.data.choices[0].message.content);
    } catch (error) {
        console.error('Mistral API Error:', error);
        throw error;
    }
}

// Add at the top with other imports
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const NEWS_API_URL = 'https://newsapi.org/v2/everything';

// Add this function to verify news with NewsAPI
async function verifyWithNewsAPI(content) {
    try {
        // Extract potential keywords from content
        const keywords = content
            .split(/\s+/)
            .filter(word => word.length > 4)
            .slice(0, 5)
            .join(' OR ');

        const response = await axios.get(NEWS_API_URL, {
            params: {
                q: keywords,
                apiKey: NEWS_API_KEY,
                language: 'en',
                sortBy: 'relevancy',
                pageSize: 5
            }
        });

        if (response.data.status === 'ok' && response.data.articles.length > 0) {
            // Compare content with found articles
            const similarityScores = response.data.articles.map(article => {
                const titleSimilarity = calculateSimilarity(content, article.title);
                const descriptionSimilarity = calculateSimilarity(content, article.description);
                return Math.max(titleSimilarity, descriptionSimilarity);
            });

            const maxSimilarity = Math.max(...similarityScores);
            return {
                isVerified: maxSimilarity > 0.6,
                confidence: Math.round(maxSimilarity * 100),
                matchedArticles: response.data.articles.slice(0, 3).map(article => ({
                    title: article.title,
                    source: article.source.name,
                    url: article.url,
                    publishedAt: article.publishedAt
                }))
            };
        }

        return {
            isVerified: false,
            confidence: 0,
            matchedArticles: []
        };
    } catch (error) {
        console.error('NewsAPI Error:', error);
        return {
            isVerified: false,
            confidence: 0,
            matchedArticles: [],
            error: error.message
        };
    }
}

// Add similarity calculation function
function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const words1 = str1.toLowerCase().split(/\s+/);
    const words2 = str2.toLowerCase().split(/\s+/);
    
    const intersection = words1.filter(word => words2.includes(word));
    const union = new Set([...words1, ...words2]);
    
    return intersection.length / union.size;
}

// Update the checkContent function to include NewsAPI verification
const checkContent = async (req, res) => {
    try {
        const { content } = req.body;
        
        if (!content) {
            return res.status(400).json({ error: 'Content is required' });
        }

        console.log('Starting content analysis...');

        // Run all analyses in parallel
        const [huggingfaceResult, mistralResult, newsApiResult] = await Promise.all([
            // Existing HuggingFace analysis
            Promise.all([
                retryWithTimeout(async (signal) => {
                    return axios.post(
                        `https://api-inference.huggingface.co/models/${MODELS.CLASSIFIER}`,
                        {
                            inputs: `${content}\nThis text is:`,
                            parameters: {
                                candidate_labels: [
                                    'news article',
                                    'opinion piece',
                                    'social media post',
                                    'advertisement',
                                    'blog post'
                                ]
                            }
                        },
                        {
                            headers: HUGGINGFACE_HEADERS,
                            signal
                        }
                    );
                }),
                retryWithTimeout(async (signal) => {
                    return axios.post(
                        `https://api-inference.huggingface.co/models/${MODELS.CLASSIFIER}`,
                        {
                            inputs: `${content}\nThis content is:`,
                            parameters: {
                                candidate_labels: [
                                    'factual',
                                    'misleading',
                                    'false',
                                    'opinion',
                                    'unverified'
                                ]
                            }
                        },
                        {
                            headers: HUGGINGFACE_HEADERS,
                            signal
                        }
                    );
                })
            ]),
            // Existing Mistral analysis
            analyzeMistral(content),
            // New NewsAPI verification
            verifyWithNewsAPI(content)
        ]);

        // Process HuggingFace results
        const [newsClassificationResponse, factCheckResponse] = huggingfaceResult;
        
        const isNews = newsClassificationResponse.data.labels[0] === 'news article';
        const contentType = newsClassificationResponse.data.labels[0];
        const contentConfidence = newsClassificationResponse.data.scores[0];

        const verificationResult = factCheckResponse.data;
        const scores = verificationResult.scores;
        const labels = verificationResult.labels;

        // Calculate detailed scores
        const factualIndex = labels.indexOf('factual');
        const misleadingIndex = labels.indexOf('misleading');
        const falseIndex = labels.indexOf('false');
        const opinionIndex = labels.indexOf('opinion');

        const credibilityScore = Math.round(
            (scores[factualIndex] * 100) -
            (scores[misleadingIndex] * 50) -
            (scores[falseIndex] * 100)
        );

        const truthScore = Math.round(
            (scores[factualIndex] * 100) -
            (scores[falseIndex] * 100)
        );

        // Source analysis
        const sources = extractNewsSource(content);
        const contentFactors = analyzeContentFactors(content);

        // Prepare comprehensive result
        const result = {
            content: content,
            contentAnalysis: {
                isNews: isNews,
                contentType: contentType,
                confidence: Math.round(contentConfidence * 100),
                factors: contentFactors
            },
            verificationResult: {
                labels: verificationResult.labels,
                scores: verificationResult.scores.map(score => Math.round(score * 100)),
                primaryClassification: verificationResult.labels[0],
                details: {
                    factualScore: Math.round(scores[factualIndex] * 100),
                    misleadingScore: Math.round(scores[misleadingIndex] * 100),
                    falseScore: Math.round(scores[falseIndex] * 100),
                    opinionScore: Math.round(scores[opinionIndex] * 100)
                }
            },
            sourceAnalysis: {
                sources: sources,
                hasIdentifiableSources: sources.length > 0,
                primarySource: sources.length > 0 ? sources[0] : null,
                sourceCount: sources.length,
                sourceTypes: [...new Set(sources.map(s => s.type))]
            },
            credibilityMetrics: {
                credibilityScore: Math.max(0, Math.min(100, credibilityScore + 50)),
                truthScore: Math.max(0, Math.min(100, truthScore + 50)),
                reliability: {
                    score: Math.round(scores[factualIndex] * 100),
                    label: getReliabilityLevel(credibilityScore),
                    confidence: Math.round(contentConfidence * 100)
                },
                contentQuality: {
                    complexity: contentFactors.complexity,
                    citations: contentFactors.citations,
                    hasQuotes: contentFactors.quotes.length > 0,
                    hasDates: contentFactors.dates.length > 0,
                    hasStatistics: contentFactors.statistics
                }
            },
            timestamp: new Date()
        };

        // Add NewsAPI results to the response
        const combinedResult = {
            ...result,
            mistralAnalysis: mistralResult,
            newsVerification: {
                isVerified: newsApiResult.isVerified,
                confidence: newsApiResult.confidence,
                matchedArticles: newsApiResult.matchedArticles,
                verdict: newsApiResult.isVerified ? 'REAL' : 'POTENTIALLY FAKE'
            },
            combinedMetrics: {
                credibilityScore: combineScores(
                    result.credibilityMetrics.credibilityScore,
                    mistralResult.credibilityScore
                ),
                truthScore: combineScores(
                    result.credibilityMetrics.truthScore,
                    mistralResult.truthScore
                ),
                confidence: Math.round(
                    (result.contentAnalysis.confidence + mistralResult.confidence) / 2
                ),
                newsReliability: newsApiResult.confidence
            }
        };

        res.json(combinedResult);

    } catch (error) {
        console.error('Analysis Error:', error);
        res.status(500).json({
            error: 'Analysis failed',
            details: error.message,
            retryAfter: 5
        });
    }
};

// Helper functions for enhanced analysis
function analyzeContentFactors(content) {
    return {
        length: content.length,
        complexity: calculateTextComplexity(content),
        citations: countCitations(content),
        quotes: extractQuotes(content),
        dates: extractDates(content),
        statistics: hasStatistics(content)
    };
}

function calculateTextComplexity(text) {
    // Basic implementation of text complexity calculation
    const words = text.split(/\s+/).filter(word => word.length > 0);
    const sentences = text.split(/[.!?]+/).filter(sentence => sentence.length > 0);
    const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
    const avgSentenceLength = words.length / sentences.length;
    
    // Complexity factors:
    // 1. Average word length (longer words = more complex)
    // 2. Average sentence length (longer sentences = more complex)
    // 3. Presence of technical/complex words
    const complexWordPattern = /\b\w{10,}\b|\b(?:therefore|however|furthermore|consequently|nevertheless)\b/gi;
    const complexWords = (text.match(complexWordPattern) || []).length;
    
    // Calculate complexity score (0-1)
    const lengthScore = Math.min(avgWordLength / 8, 1) * 0.3;
    const sentenceScore = Math.min(avgSentenceLength / 25, 1) * 0.3;
    const complexityScore = Math.min(complexWords / (words.length * 0.1), 1) * 0.4;
    
    return lengthScore + sentenceScore + complexityScore;
}

function adjustScoreByFactors(score, factors) {
    let adjustment = 0;
    
    // Adjust based on content length (longer content tends to be more reliable)
    adjustment += factors.length > 1000 ? 5 : 0;
    
    // Adjust based on complexity (more complex writing often indicates expertise)
    adjustment += factors.complexity > 0.7 ? 5 : 0;
    
    // Adjust based on citations and quotes
    adjustment += factors.citations > 2 ? 5 : 0;
    adjustment += factors.quotes.length > 0 ? 5 : 0;
    
    // Adjust based on presence of dates and statistics
    adjustment += factors.dates.length > 0 ? 5 : 0;
    adjustment += factors.statistics ? 5 : 0;

    return Math.max(0, Math.min(100, score + adjustment));
}

function calculateSourceReliability(sourceScores) {
    return sourceScores.reduce((acc, curr) => {
        const reliabilityWeight = {
            'reliable': 100,
            'questionable': -50,
            'unknown': 0
        }[curr.reliability] || 0;

        return acc + (reliabilityWeight * curr.confidence);
    }, 0) / sourceScores.length;
}

function getReliabilityLevel(score) {
    if (score >= 80) return 'highly reliable';
    if (score >= 60) return 'reliable';
    if (score >= 40) return 'moderately reliable';
    if (score >= 20) return 'somewhat unreliable';
    return 'unreliable';
}

function analyzeSourceFactors(sourceScore) {
    return {
        reliability: sourceScore.reliability,
        confidence: sourceScore.confidence,
        additionalLabels: sourceScore.allLabels || [],
        additionalScores: sourceScore.allScores || []
    };
}

function analyzeReliabilityFactors(verificationResult) {
    return {
        primaryLabel: verificationResult.labels[0],
        primaryScore: verificationResult.scores[0],
        allLabels: verificationResult.labels,
        allScores: verificationResult.scores
    };
}

function analyzeAuthenticityFactors(credibilityScore, truthScore) {
    return {
        credibilityContribution: credibilityScore,
        truthContribution: truthScore,
        overallScore: Math.round((credibilityScore + truthScore) / 2)
    };
}

function countCitations(content) {
    const citationPatterns = [
        /according to/gi,
        /cited by/gi,
        /reported by/gi,
        /source:/gi,
        /\[\d+\]/g,  // [1], [2], etc.
        /\(\d{4}\)/g  // (2023), (2024), etc.
    ];

    return citationPatterns.reduce((count, pattern) => {
        const matches = content.match(pattern);
        return count + (matches ? matches.length : 0);
    }, 0);
}

function extractQuotes(content) {
    const quotes = [];
    const patterns = [
        /"([^"]+)"/g,  // "quote"
        /'([^']+)'/g,  // 'quote'
        /"([^"]+)"/g,  // "quote"
        /'([^']+)'/g   // 'quote'
    ];

    patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            quotes.push(match[1]);
        }
    });

    return quotes;
}

function extractDates(content) {
    const datePatterns = [
        /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,  // MM/DD/YYYY
        /\b\d{4}-\d{2}-\d{2}\b/g,           // YYYY-MM-DD
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b/g  // Month DD, YYYY
    ];

    const dates = [];
    datePatterns.forEach(pattern => {
        const matches = content.match(pattern);
        if (matches) {
            dates.push(...matches);
        }
    });

    return dates;
}

function hasStatistics(content) {
    const statPatterns = [
        /\d+%/g,                   // Percentages
        /\$\d+(?:\.\d{2})?/g,     // Dollar amounts
        /\d+ (?:million|billion|trillion)/gi,  // Large numbers
        /increased by|\bdecreased by|\bgrew by/gi,  // Trends
        /statistics show|according to data|survey shows/gi  // Statistical references
    ];

    return statPatterns.some(pattern => pattern.test(content));
}

// Helper function to combine scores from both APIs
function combineScores(score1, score2, weight1 = 0.6, weight2 = 0.4) {
    return Math.round((score1 * weight1) + (score2 * weight2));
}

// Export the functions
module.exports = {
    checkContent
};
