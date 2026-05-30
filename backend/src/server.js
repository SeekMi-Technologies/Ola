require('module-alias/register');
const mongoose = require('mongoose');
const { globSync } = require('glob');
const path = require('path');

// Make sure we are running node 7.6+
const [major, minor] = process.versions.node.split('.').map(parseFloat);
if (major < 20) {
  console.log('Please upgrade your node.js version at least 20 or greater. 👌\n ');
  process.exit();
}

// import environmental variables from our variables.env file
require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: '.env.local' });

console.log('Connecting to MongoDB database:', process.env.DATABASE);

// Increase timeouts for Docker environment
mongoose.connect(process.env.DATABASE, {
  tls: true,
  tlsAllowInvalidCertificates: true,
  serverSelectionTimeoutMS: 30000, // 30 seconds
  socketTimeoutMS: 45000, // 45 seconds
  family: 4 // Force IPv4
}).catch(err => {
  console.error('MongoDB connection error. Please make sure MongoDB is running:', err.message);
});

mongoose.connection.on('error', (error) => {
  console.log(
    `1. 🔥 Common Error caused issue → : check your .env file first and add your mongodb url`
  );
  console.error(`2. 🚫 Error → : ${error.message}`);
});

// 导入所有模型文件
const modelsFiles = globSync('./src/models/**/*.js');

for (const filePath of modelsFiles) {
  require(path.resolve(filePath));
}

// 导入索引设置函数

const setupIndexes = require('./setup/indexSetup');

mongoose.connection.once('open', async () => {
  console.log('✅ MongoDB database connection established successfully');

  // 设置数据库索引
  try {
    await setupIndexes();
  } catch (error) {
    console.error('设置索引时出错:', error);
  }

  // Resume orphan transcription Jobs that were running/pending when the process crashed
  try {
    const resumeOrphanJobs = require('./jobs/resumeOrphanJobs');
    await resumeOrphanJobs();
  } catch (error) {
    console.error('[resume-orphan-jobs] startup error:', error.message);
  }
});

// Start our app!
const app = require('./app');
app.set('port', process.env.PORT || 8888);
const server = app.listen(app.get('port'), () => {
  console.log(`Express running → On PORT : ${server.address().port}`);
});
