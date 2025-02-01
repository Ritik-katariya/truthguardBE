const mongoose = require('mongoose');

const UserReportSchema = new mongoose.Schema({
  content: { type: String, required: true },
  reliability: { type: String, required: true },
  details: { type: String },
  huggingfaceAnalysis: { type: Object },
  mistralAnalysis: { type: Object },
  newsVerification: {
    isVerified: Boolean,
    confidence: Number,
    matchedArticles: [{
      title: String,
      source: String,
      url: String,
      publishedAt: Date
    }],
    verdict: String
  },
  combinedMetrics: {
    credibilityScore: { type: Number },
    truthScore: { type: Number },
    confidence: { type: Number },
    newsReliability: { type: Number }
  },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model('UserReport', UserReportSchema);
