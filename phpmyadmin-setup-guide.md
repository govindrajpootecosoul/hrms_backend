# phpMyAdmin Setup Guide

## Access phpMyAdmin
1. Open your browser
2. Go to: **http://192.168.50.29/**
3. Login with:
   - **Username**: root
   - **Password**: Thrive@2910

## Create Database Manually

### Option 1: Using SQL Tab
1. After logging into phpMyAdmin, click on the **SQL** tab
2. Copy and paste the following SQL:

```sql
-- Create database
CREATE DATABASE IF NOT EXISTS worklytics_hrms;
USE worklytics_hrms;

-- Create users table
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

3. Click **Go** to execute

### Option 2: Using Database Tab
1. Click on **Databases** in the top menu
2. Enter database name: `worklytics_hrms`
3. Select collation: `utf8mb4_unicode_ci`
4. Click **Create**
5. Select the `worklytics_hrms` database from the left sidebar
6. Click on **SQL** tab
7. Paste the table creation SQL (the CREATE TABLE part only, without CREATE DATABASE)
8. Click **Go**

## Verify Setup
After creating the database and table:
1. Click on `worklytics_hrms` in the left sidebar
2. You should see the `users` table listed
3. Click on `users` to view the table structure

## Test Connection from Backend
After setting up the database in phpMyAdmin, test the backend connection:
```bash
cd worklytics_HRMS_backend
npm run dev
```

You should see: `✅ Database connected successfully`

