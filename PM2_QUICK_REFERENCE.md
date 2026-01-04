# PM2 Quick Reference Guide

## 🚀 Starting Both Services

### Start Backend and Frontend Together
```powershell
cd C:\shivank\worklytics_HRMSAsset_NextJS\worklytics_HRMS_backend
pm2 start ecosystem.config.js --env production
```

### Start Individual Services
```powershell
# Start only backend
pm2 start ecosystem.config.js --only HRMS-backend --env production

# Start only frontend
pm2 start ecosystem.config.js --only HRMS-frontend --env production
```

## 📋 Viewing Status

### List All Processes
```powershell
pm2 list
```

### View Logs
```powershell
# Backend logs
pm2 logs HRMS-backend

# Frontend logs
pm2 logs HRMS-frontend

# All logs
pm2 logs

# Last 50 lines
pm2 logs HRMS-backend --lines 50
```

### Monitor Dashboard
```powershell
pm2 monit
```

## 🔄 Managing Processes

### Restart Services
```powershell
# Restart all
pm2 restart all

# Restart specific service
pm2 restart HRMS-backend
pm2 restart HRMS-frontend
```

### Stop Services
```powershell
# Stop all
pm2 stop all

# Stop specific service
pm2 stop HRMS-backend
pm2 stop HRMS-frontend
```

### Delete Services
```powershell
# Delete all
pm2 delete all

# Delete specific service
pm2 delete HRMS-backend
pm2 delete HRMS-frontend
```

## 💾 Saving Configuration

### Save Current Process List
```powershell
pm2 save
```

This saves the current PM2 process list so it can be restored after system restart.

### Setup Auto-Start on Boot
```powershell
pm2 startup
# Follow the instructions shown to enable auto-start
```

## 🔍 Useful Commands

### View Process Information
```powershell
pm2 show HRMS-backend
pm2 show HRMS-frontend
```

### View Process Tree
```powershell
pm2 list --sort name
```

### Clear All Logs
```powershell
pm2 flush
```

### Reload (Zero Downtime)
```powershell
pm2 reload HRMS-backend
```

## 📊 Current Setup

- **Backend:** HRMS-backend (12 cluster instances on port 5008)
- **Frontend:** HRMS-frontend (1 instance on port 4000)
- **Config File:** `worklytics_HRMS_backend/ecosystem.config.js`

## 🌐 Access URLs

- **Frontend:** http://localhost:4000
- **Backend API:** http://localhost:5008/api
- **Health Check:** http://localhost:5008/api/health

## ⚠️ Troubleshooting

### Service Keeps Restarting
```powershell
# Check logs for errors
pm2 logs HRMS-frontend --err
pm2 logs HRMS-backend --err
```

### Port Already in Use
```powershell
# Find process using port
netstat -ano | findstr :4000
netstat -ano | findstr :5008

# Kill process (replace PID)
taskkill /PID <PID> /F
```

### Reset Everything
```powershell
pm2 delete all
pm2 flush
pm2 start ecosystem.config.js --env production
pm2 save
```

