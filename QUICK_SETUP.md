# Quick Setup Guide - phpMyAdmin

## Step 1: Access phpMyAdmin
1. Open browser
2. Go to: **http://192.168.50.29/**
3. Login:
   - Username: `root`
   - Password: `Thrive@2910`

## Step 2: Create Database
1. Click on **SQL** tab (top menu)
2. Copy and paste this SQL:

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

3. Click **Go** button

## Step 3: Verify
1. Check left sidebar - you should see `worklytics_hrms` database
2. Click on it
3. You should see `users` table

## Step 4: Test Backend Connection
```bash
cd worklytics_HRMS_backend
npm run test-connection
```

If connection works, start the server:
```bash
npm run dev
```

## Database Credentials (Already Configured)
- Host: 192.168.50.29
- Port: 3306
- Username: root
- Password: Thrive@2910
- Database: worklytics_hrms

