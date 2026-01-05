const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const { config, ports, getMongoUri, getBackendUrl } = require('../config/app.config');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/queries', require('./routes/queries'));
app.use('/api/users', require('./routes/users'));
app.use('/api/reports', require('./routes/reports'));

// MongoDB Connection
const queryTrackerUri = getMongoUri(config.mongodb.queryTrackerDbName);
mongoose.connect(queryTrackerUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB Connected'))
.catch(err => console.error('MongoDB connection error:', err));

const PORT = ports.queryTracker;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

