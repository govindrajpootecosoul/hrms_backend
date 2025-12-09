# Quick Start Guide - Worklytics HRMS

## ✅ Project Database Configuration
- **Database Name**: `worklytics_hrms` (Project-specific)
- **User**: `apiuser`
- **Password**: `Thrive@2910`
- **Host**: 192.168.50.29
- **Port**: 3306
- **Pool Size**: 12 connections

## 🚀 Quick Setup (2 Steps)

### Step 1: Create Database & Table
1. Open phpMyAdmin: http://192.168.50.29/
2. Login: `apiuser` / `Thrive@2910`
3. Click **SQL** tab
4. Copy and paste:

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

5. Click **Go**

### Step 2: Test & Start
```bash
# Test connection
npm run test-connection

# Start server
npm run dev
```

You should see: `✅ Database connected successfully`

## 📋 Current Configuration
All files have been updated with:
- Host: 192.168.50.29
- Port: 3306
- User: apiuser
- Password: Thrive@2910
- Database: **worklytics_hrms** (Project-specific)
- Pool Size: 12

## 🔧 Files Updated
- ✅ `config/database.js` - Main database config
- ✅ `test-connection.js` - Test script
- ✅ `setup-database.js` - Setup script
- ✅ All error messages updated

