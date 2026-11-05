const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');
const env = process.env.NODE_ENV || 'development';

const config = {
  root: ROOT,
  env,
  isProd: env === 'production',
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '127.0.0.1',
  sessionSecret: process.env.SESSION_SECRET || '',
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  uploadDir: path.resolve(ROOT, process.env.UPLOAD_DIR || 'uploads'),
  httpsOnly: process.env.HTTPS_ONLY === '1',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminName: process.env.ADMIN_NAME || 'Administrator',
};

if (config.isProd && (!config.sessionSecret || config.sessionSecret.length < 32)) {
  console.error('SESSION_SECRET must be set to a random string of at least 32 characters in production.');
  process.exit(1);
}
if (!config.sessionSecret) {
  config.sessionSecret = 'dev-only-secret-change-me-dev-only-secret';
}

module.exports = config;
