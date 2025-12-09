# Quick Solution for Access Denied Error

## The Problem
MySQL is rejecting the connection because `root` user doesn't have permission to connect from your IP (`192.168.50.107`).

## Quick Fix (2 Steps)

### Step 1: Open phpMyAdmin
Go to: **http://192.168.50.29/**
- Username: `root`
- Password: `Thrive@2910`

### Step 2: Run This SQL
1. Click **SQL** tab
2. Copy and paste this:

```sql
GRANT ALL PRIVILEGES ON worklytics_hrms.* TO 'root'@'%' IDENTIFIED BY 'Thrive@2910';
FLUSH PRIVILEGES;
```

3. Click **Go**

### Step 3: Restart Backend
```bash
npm run dev
```

You should now see: `✅ Database connected successfully`

---

## Alternative: If Still Not Working

### Option A: Create Database User (More Secure)
Run in phpMyAdmin SQL tab:

```sql
-- Create new user for the app
CREATE USER 'worklytics_user'@'%' IDENTIFIED BY 'Thrive@2910';
GRANT ALL PRIVILEGES ON worklytics_hrms.* TO 'worklytics_user'@'%';
FLUSH PRIVILEGES;
```

Then update `.env`:
```env
DB_USER=worklytics_user
DB_PASSWORD=Thrive@2910
```

### Option B: Check MySQL Bind Address
If MySQL server is on the same machine, check if it's listening on all interfaces:
- Edit MySQL config: `/etc/mysql/mysql.conf.d/mysqld.cnf`
- Set: `bind-address = 0.0.0.0`
- Restart MySQL: `sudo systemctl restart mysql`

