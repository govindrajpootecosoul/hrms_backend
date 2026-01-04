# Quick Start - Production Setup

## 🚀 Fast Setup (5 Minutes)

### 1. MongoDB Setup (One-time)

```powershell
# Copy mongod.cfg to C:\mongodb\mongod.cfg
# Then run:
net stop MongoDB
mongod --config "C:\mongodb\mongod.cfg" --install
net start MongoDB

# Create admin user
mongosh "mongodb://192.168.50.107:27017"
# In MongoDB shell:
use admin
db.createUser({
  user: "hrms_admin",
  pwd: "HRMS2025$ecurePass!",
  roles: [{role: "root", db: "admin"}]
})
exit

# Allow firewall
New-NetFirewallRule -DisplayName "MongoDB-27017" -Direction Inbound -Protocol TCP -LocalPort 27017 -Action Allow
```

### 2. Start Production Backend

```powershell
cd C:\shivank\worklytics_HRMSAsset_NextJS\worklytics_HRMS_backend
.\start-prod.bat
```

### 3. Start Production Frontend

```powershell
cd C:\shivank\worklytics_HRMSAsset_NextJS\worklytics_HRMS_frontend
npm run build
npm run start -- -p 4000
```

### 4. Test Everything

```powershell
# Run network test
cd C:\shivank\worklytics_HRMSAsset_NextJS\worklytics_HRMS_backend
powershell -ExecutionPolicy Bypass -File .\test-network.ps1
```

## 📋 Daily Commands

### Start Production
```powershell
# Terminal 1 - Backend
cd worklytics_HRMS_backend
npm run prod:backend

# Terminal 2 - Frontend
cd worklytics_HRMS_frontend
npm run build && npm run start -- -p 4000
```

### Monitor
```powershell
pm2 list
pm2 logs HRMS-backend
pm2 monit
```

### Stop Production
```powershell
pm2 delete HRMS-backend
```

## 🔗 URLs

- **Frontend:** http://localhost:4000
- **Backend API:** http://localhost:5008/api
- **Health Check:** http://localhost:5008/api/health

## ⚠️ Troubleshooting

**Backend not starting?**
```powershell
pm2 logs HRMS-backend --lines 50
```

**MongoDB connection failed?**
```powershell
net start MongoDB
mongosh "mongodb://hrms_admin:HRMS2025$ecurePass!@192.168.50.107:27017/hrms_prod?authSource=admin"
```

**Port already in use?**
```powershell
netstat -ano | findstr :5008
taskkill /PID <PID> /F
```

For detailed troubleshooting, see `PRODUCTION_SETUP.md`

