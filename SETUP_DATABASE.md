# Database Setup Guide - Worklytics HRMS

## Database Configuration
- **Database Name**: `worklytics_hrms` (Project-specific)
- **Host**: 192.168.50.29
- **Port**: 3306
- **User**: apiuser
- **Password**: Thrive@2910

## Setup Methods

### Method 1: Using phpMyAdmin (Recommended)

1. **Access phpMyAdmin**
   - Go to: http://192.168.50.29/
   - Login: `apiuser` / `Thrive@2910`

2. **Create Database**
   - Click **SQL** tab
   - Copy and paste the entire SQL from `database/create-database.sql`
   - Click **Go**

   OR manually:
   - Click **Databases** tab
   - Enter: `worklytics_hrms`
   - Collation: `utf8mb4_unicode_ci`
   - Click **Create**

3. **Create Users Table**
   - Select `worklytics_hrms` database
   - Click **SQL** tab
   - Run the CREATE TABLE SQL from `database/schema.sql`

### Method 2: Using Setup Script

```bash
cd worklytics_HRMS_backend
npm run setup-db
```

This will automatically:
- Create `worklytics_hrms` database
- Create `users` table

### Method 3: Quick SQL (Copy & Paste)

Run this in phpMyAdmin SQL tab:

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

## Verify Setup

```bash
npm run test-connection
```

You should see:
- ✅ Connection successful!
- ✅ Users table exists

## Start Server

```bash
npm run dev
```

Expected output:
```
🚀 Server running on http://localhost:5008
✅ Database connected successfully
   Host: 192.168.50.29
   User: apiuser
   Database: worklytics_hrms
```

