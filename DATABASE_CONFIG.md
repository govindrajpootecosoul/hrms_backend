# Database Configuration - Worklytics HRMS

## ✅ Project Database
**Database Name**: `worklytics_hrms` (Project-specific, not shared with other projects)

## Connection Details
- **Host**: 192.168.50.29
- **Port**: 3306
- **User**: apiuser
- **Password**: Thrive@2910
- **Database**: worklytics_hrms
- **Pool Size**: 12 connections

## Quick Setup

### Step 1: Create Database in phpMyAdmin
1. Go to: http://192.168.50.29/
2. Login: `apiuser` / `Thrive@2910`
3. Click **SQL** tab
4. Run this SQL:

```sql
CREATE DATABASE IF NOT EXISTS worklytics_hrms;
USE worklytics_hrms;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(20) NOT NULL,
  role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Step 2: Test Connection
```bash
npm run test-connection
```

### Step 3: Start Server
```bash
npm run dev
```

## Files Updated
- ✅ `config/database.js` - Uses `worklytics_hrms` database
- ✅ `test-connection.js` - Updated database name
- ✅ `setup-database.js` - Creates `worklytics_hrms` database
- ✅ `database/schema.sql` - Already has correct database name
- ✅ `database/create-database.sql` - Complete setup SQL

## Environment Variables (Optional)
Create `.env` file to override defaults:

```env
DB_HOST=192.168.50.29
DB_PORT=3306
DB_USER=apiuser
DB_PASSWORD=Thrive@2910
DB_NAME=worklytics_hrms
DB_POOL_SIZE=12
JWT_SECRET=your-secret-key-change-in-production
PORT=5008
```

