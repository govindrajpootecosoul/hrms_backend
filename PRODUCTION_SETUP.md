# HRMS Production Setup Guide

## 📋 Table of Contents
1. [MongoDB Network Configuration](#mongodb-network-configuration)
2. [PM2 Production Setup](#pm2-production-setup)
3. [Frontend Production Build](#frontend-production-build)
4. [Complete Workflow](#complete-workflow)
5. [Network Testing](#network-testing)
6. [Troubleshooting](#troubleshooting)

---

## 1. MongoDB Network Configuration

### Step 1: Create MongoDB Configuration File

Create `C:\mongodb\mongod.cfg` with the following content:

```yaml
storage:
  dbPath: C:\data\db
systemLog:
  destination: file
  path: C:\data\log\mongod.log
  logAppend: true
net:
  port: 27017
  bindIp: 127.0.0.1,0.0.0.0
security:
  authorization: enabled
```

### Step 2: Install MongoDB as Windows Service

Open PowerShell as Administrator and run:

```powershell
# Stop existing MongoDB service
net stop MongoDB

# Install MongoDB with new configuration
mongod --config "C:\mongodb\mongod.cfg" --install

# Start MongoDB service
net start MongoDB
```

### Step 3: Create Admin User

Connect to MongoDB and create admin user:

```powershell
mongosh "mongodb://192.168.50.107:27017"
```

In MongoDB shell:

```javascript
use admin
db.createUser({
  user: "hrms_admin",
  pwd: "HRMS2025$ecurePass!",
  roles: [{role: "root", db: "admin"}]
})
```

Exit MongoDB shell:
```javascript
exit
```

### Step 4: Configure Windows Firewall

Allow MongoDB port through firewall:

```powershell
New-NetFirewallRule -DisplayName "MongoDB-27017" -Direction Inbound -Protocol TCP -LocalPort 27017 -Action Allow
```

### Step 5: Test MongoDB Connection

```powershell
# Test local connection
mongosh "mongodb://hrms_admin:HRMS2025$ecurePass!@192.168.50.107:27017/hrms_prod?authSource=admin"

# Test from another machine (replace 192.168.x.x with your LAN IP)
mongosh "mongodb://hrms_admin:HRMS2025$ecurePass!@192.168.x.x:27017/hrms_prod?authSource=admin"
```

---

## 2. PM2 Production Setup

### Step 1: Install PM2 Globally

```powershell
npm install -g pm2
```

### Step 2: Navigate to Backend Directory

```powershell
cd C:\shivank\worklytics_HRMSAsset_NextJS\worklytics_HRMS_backend
```

### Step 3: Start Backend with PM2

**Option A: Using Batch File (Recommended)**
```powershell
.\start-prod.bat
```

**Option B: Manual Commands**
```powershell
# Clean up existing processes
pm2 delete all
pm2 flush

# Start backend
npm run prod:backend

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
```

### Step 4: Verify Backend is Running

```powershell
# List all PM2 processes
pm2 list

# View logs
pm2 logs HRMS-backend --lines 50

# Monitor processes
pm2 monit
```

---

## 3. Frontend Production Build

### Step 1: Build Next.js Application

```powershell
cd C:\shivank\worklytics_HRMSAsset_NextJS\worklytics_HRMS_frontend
npm run build
```

### Step 2: Serve Production Build

**Option A: Using serve (Static Export)**
```powershell
# Install serve globally if not already installed
npm install -g serve

# Serve on port 4000
npx serve -s out -l 4000
```

**Option B: Using Next.js Standalone (Recommended)**
```powershell
npm run start -- -p 4000
```

---

## 4. Complete Workflow

### Terminal 1 - Production Backend

```powershell
cd C:\shivank\worklytics_HRMSAsset_NextJS\worklytics_HRMS_backend
npm run prod:backend
```

### Terminal 2 - Production Frontend

```powershell
cd C:\shivank\worklytics_HRMSAsset_NextJS\worklytics_HRMS_frontend
npm run build
npm run start -- -p 4000
```

### Terminal 3 - Development (Optional)

```powershell
cd C:\shivank\worklytics_HRMSAsset_NextJS\worklytics_HRMS_frontend
npm run dev
# Backend dev runs on port 3001 (if started separately)
```

---

## 5. Network Testing

### Find Your LAN IP Address

```powershell
ipconfig
# Look for IPv4 Address under your active network adapter
# Example: 192.168.1.100
```

### Test URLs

**Production:**
- Frontend: `http://localhost:4000`
- Backend API: `http://localhost:5008/api`
- Health Check: `http://localhost:5008/api/health`

**From Network:**
- Frontend: `http://192.168.x.x:4000`
- Backend API: `http://192.168.x.x:5008/api`
- MongoDB: `mongodb://hrms_admin:HRMS2025$ecurePass!@192.168.x.x:27017/hrms_prod?authSource=admin`

### Test MongoDB Network Connection

From another machine on the same network:

```powershell
mongosh "mongodb://hrms_admin:HRMS2025$ecurePass!@192.168.x.x:27017/hrms_prod?authSource=admin"
```

### Test Backend API from Network

```powershell
# Health check
curl http://192.168.x.x:5008/api/health

# Or use browser
# http://192.168.x.x:5008/api/health
```

---

## 6. Troubleshooting

### PM2 Issues

**Problem: "Script not found: PORT=5008"**
- **Solution:** Use `ecosystem.config.js` instead of command-line arguments
- **Fix:** Run `npm run prod:backend` instead of `pm2 start server.js -- PORT=5008`

**Problem: PM2 process not starting**
```powershell
# Check PM2 logs
pm2 logs HRMS-backend --err

# Check if port 5008 is already in use
netstat -ano | findstr :5008

# Kill process on port 5008 (replace PID with actual process ID)
taskkill /PID <PID> /F
```

**Problem: PM2 not persisting after restart**
```powershell
# Save PM2 configuration
pm2 save

# Setup startup script
pm2 startup
# Follow the instructions shown
```

### MongoDB Issues

**Problem: MongoDB connection failed**
```powershell
# Check if MongoDB service is running
net start MongoDB

# Check MongoDB logs
type C:\data\log\mongod.log

# Test connection
mongosh "mongodb://192.168.50.107:27017"
```

**Problem: Authentication failed**
- Verify admin user exists: `mongosh "mongodb://192.168.50.107:27017/admin"` then `db.getUsers()`
- Check connection string includes `authSource=admin`
- Verify password: `HRMS2025$ecurePass!`

**Problem: Network access not working**
- Check firewall rule: `Get-NetFirewallRule -DisplayName "MongoDB-27017"`
- Verify `bindIp` includes `0.0.0.0` in `mongod.cfg`
- Check if MongoDB service is running: `net start MongoDB`

### Port Conflicts

**Check what's using a port:**
```powershell
# Port 5008 (Backend)
netstat -ano | findstr :5008

# Port 4000 (Frontend)
netstat -ano | findstr :4000

# Port 27017 (MongoDB)
netstat -ano | findstr :27017
```

**Kill process on port:**
```powershell
# Find PID first, then kill
taskkill /PID <PID> /F
```

### Backend Not Starting

**Check server.js logs:**
```powershell
# View PM2 logs
pm2 logs HRMS-backend --lines 100

# Check for MongoDB connection errors
pm2 logs HRMS-backend | findstr "mongo"
```

**Verify environment variables:**
- Check `ecosystem.config.js` has correct PORT
- Verify MongoDB connection string in `config/mongo.js`

### Frontend Build Issues

**Build fails:**
```powershell
# Clear Next.js cache
cd worklytics_HRMS_frontend
rm -r .next
npm run build
```

**Port 4000 already in use:**
```powershell
# Find and kill process
netstat -ano | findstr :4000
taskkill /PID <PID> /F
```

---

## 7. Useful Commands Reference

### PM2 Commands
```powershell
pm2 list                    # List all processes
pm2 logs HRMS-backend       # View logs
pm2 logs HRMS-backend --lines 50  # Last 50 lines
pm2 monit                   # Monitor dashboard
pm2 restart HRMS-backend    # Restart process
pm2 stop HRMS-backend       # Stop process
pm2 delete HRMS-backend     # Delete process
pm2 save                    # Save current process list
pm2 flush                   # Clear all logs
pm2 startup                 # Setup auto-start on boot
```

### MongoDB Commands
```powershell
# Start/Stop MongoDB service
net start MongoDB
net stop MongoDB

# Connect to MongoDB
mongosh "mongodb://hrms_admin:HRMS2025$ecurePass!@192.168.50.107:27017/hrms_prod?authSource=admin"

# View MongoDB logs
type C:\data\log\mongod.log
```

### Network Commands
```powershell
# Find IP address
ipconfig

# Test port connectivity
Test-NetConnection -ComputerName localhost -Port 5008
Test-NetConnection -ComputerName localhost -Port 4000
Test-NetConnection -ComputerName localhost -Port 27017
```

---

## 8. Environment Variables

### Production Environment
- `NODE_ENV=production`
- `PORT=5008`
- `MONGO_URI=mongodb://hrms_admin:HRMS2025$ecurePass!@192.168.50.107:27017/hrms_prod?authSource=admin`

### Development Environment
- `NODE_ENV=development` (or not set)
- `PORT=3001` (or default 5008)
- `MONGO_URI=mongodb://192.168.50.107:27017/`

---

## 9. Security Notes

1. **Change default passwords** in production
2. **Use environment variables** for sensitive data
3. **Enable MongoDB authentication** (already configured)
4. **Configure firewall rules** properly
5. **Use HTTPS** in production (consider using reverse proxy like nginx)
6. **Regular backups** of MongoDB data

---

## 10. Git Branching

### Create Production Branch

```powershell
# Create and switch to production branch
git checkout -b hrms-prod-stable

# Push to remote
git push -u origin hrms-prod-stable
```

---

## Support

For issues or questions:
1. Check PM2 logs: `pm2 logs HRMS-backend`
2. Check MongoDB logs: `C:\data\log\mongod.log`
3. Verify all services are running
4. Check firewall and network settings

