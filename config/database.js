const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || '192.168.50.29',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'apiuser',
  password: process.env.DB_PASSWORD || 'Thrive@2910',
  database: process.env.DB_NAME || 'worklytics_hrms',
  waitForConnections: true,
  connectionLimit: process.env.DB_POOL_SIZE || 12,
  queueLimit: 0
});

// Test connection with better error handling
pool.getConnection()
  .then(connection => {
    console.log('✅ Database connected successfully');
    console.log(`   Host: ${process.env.DB_HOST || '192.168.50.29'}`);
    console.log(`   User: ${process.env.DB_USER || 'apiuser'}`);
    console.log(`   Database: ${process.env.DB_NAME || 'worklytics_hrms'}`);
    connection.release();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
    console.error('\n💡 Troubleshooting steps:');
    console.error('1. Make sure database "worklytics_hrms" exists in phpMyAdmin');
    console.error('2. Verify user "apiuser" has access to database "worklytics_hrms"');
    console.error('3. Grant remote access - Run SQL in phpMyAdmin:');
    console.error('   GRANT ALL PRIVILEGES ON worklytics_hrms.* TO \'apiuser\'@\'%\' IDENTIFIED BY \'Thrive@2910\';');
    console.error('   FLUSH PRIVILEGES;');
    console.error('4. Check file: grant-access.sql for detailed SQL commands');
    console.error('5. Verify MySQL server allows remote connections');
  });

module.exports = pool;

