const mongoose = require('mongoose');
require('dotenv').config();

console.log('Testing MongoDB connection...');
console.log('MongoDB URI:', process.env.MONGO_URI);

mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 10000,
    heartbeatFrequencyMS: 5000,
    retryWrites: true,
    w: 'majority',
    ssl: true,
    tlsAllowInvalidCertificates: true
})
.then(() => {
    console.log('MongoDB Connected Successfully');
    process.exit(0);
})
.catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
}); 