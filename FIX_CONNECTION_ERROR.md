# Fix "Access Denied" Error

## Problem
The error `Access denied for user 'root'@'192.168.50.107'` means MySQL root user doesn't have permission to connect from your local IP.

## Solution 1: Grant Remote Access (Recommended)

### Step 1: Login to phpMyAdmin
1. Go to: http://192.168.50.29/
2. Login with root / Thrive@2910

### Step 2: Run SQL to Grant Remote Access
1. Click on **SQL** tab
2. Run this SQL (replace `192.168.50.107` with your actual IP if different):

```sql
-- Grant access from your local IP
GRANT ALL PRIVILEGES ON worklytics_hrms.* TO 'root'@'192.168.50.107' IDENTIFIED BY 'Thrive@2910';

-- Or grant access from any IP in your network (less secure but easier)
GRANT ALL PRIVILEGES ON worklytics_hrms.* TO 'root'@'192.168.50.%' IDENTIFIED BY 'Thrive@2910';

-- Or grant access from any IP (least secure, only for development)
GRANT ALL PRIVILEGES ON worklytics_hrms.* TO 'root'@'%' IDENTIFIED BY 'Thrive@2910';

-- Apply changes
FLUSH PRIVILEGES;
```

### Step 3: Verify
Run the test connection:
```bash
npm run test-connection
```

## Solution 2: Create .env File

Create a `.env` file in `worklytics_HRMS_backend/` folder:

```env
DB_HOST=192.168.50.29
DB_PORT=3306
DB_USER=root
DB_PASSWORD=Thrive@2910
DB_NAME=worklytics_hrms
JWT_SECRET=your-secret-key-change-in-production
PORT=5000
```

## Solution 3: Check MySQL Configuration

If the above doesn't work, check MySQL bind-address:
1. On the MySQL server (192.168.50.29), check `/etc/mysql/mysql.conf.d/mysqld.cnf`
2. Make sure `bind-address` is set to `0.0.0.0` or `192.168.50.29` (not `127.0.0.1`)

## Quick Fix: Use Localhost if on Same Machine

If you're running the backend on the same machine as MySQL (192.168.50.29), use `localhost` instead:

```env
DB_HOST=localhost
```

