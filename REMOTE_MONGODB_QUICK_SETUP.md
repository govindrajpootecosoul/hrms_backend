# Quick Setup: MongoDB Network Connection

## 🎯 Goal
Connect to MongoDB running on device `192.168.50.107:27017` from your current device.

## ⚡ Quick Steps (On Remote Device - 192.168.50.107)

### Step 1: Check MongoDB Status
```powershell
# On remote device (192.168.50.107)
net start MongoDB
```

### Step 2: Update MongoDB Configuration

**Edit `C:\mongodb\mongod.cfg` on remote device:**

```yaml
storage:
  dbPath: C:\data\db
systemLog:
  destination: file
  path: C:\data\log\mongod.log
  logAppend: true
net:
  port: 27017
  bindIp: 0.0.0.0  # ⚠️ IMPORTANT: This allows network connections
security:
  authorization: disabled  # Set to 'enabled' if you want auth
```

**Key Change:** `bindIp: 0.0.0.0` (not `127.0.0.1`)

### Step 3: Restart MongoDB
```powershell
# On remote device (192.168.50.107)
net stop MongoDB
mongod --config "C:\mongodb\mongod.cfg" --install
net start MongoDB
```

### Step 4: Configure Firewall
```powershell
# On remote device (192.168.50.107) - Run as Administrator
New-NetFirewallRule -DisplayName "MongoDB-27017" -Direction Inbound -Protocol TCP -LocalPort 27017 -Action Allow
```

### Step 5: Verify Configuration
```powershell
# On remote device (192.168.50.107)
netstat -ano | findstr :27017
```

**Expected Output:**
```
TCP    0.0.0.0:27017          0.0.0.0:0              LISTENING       <PID>
```

If you see `127.0.0.1:27017` instead, MongoDB is only listening on localhost.

## ✅ Test Connection (On Your Device)

```powershell
# Test network connectivity
Test-NetConnection -ComputerName 192.168.50.107 -Port 27017

# Test MongoDB connection
cd C:\shivank\worklytics_HRMSAsset_NextJS\worklytics_HRMS_backend
node test-mongodb-connection.js
```

## 🚀 Start Application

```powershell
cd C:\shivank\worklytics_HRMSAsset_NextJS\worklytics_HRMS_backend
pm2 restart HRMS-backend
pm2 logs HRMS-backend
```

## 🔍 Troubleshooting

### Connection Refused
- ✅ MongoDB service running? `net start MongoDB`
- ✅ bindIp set to `0.0.0.0`? Check `mongod.cfg`
- ✅ Firewall rule created? Check with `Get-NetFirewallRule -DisplayName "MongoDB-27017"`
- ✅ MongoDB restarted after config change?

### Cannot Ping Device
- ✅ Both devices on same network?
- ✅ Correct IP address? Check with `ipconfig` on remote device
- ✅ Network connectivity? `ping 192.168.50.107`

### Port Not Listening
- ✅ Check `netstat -ano | findstr :27017`
- ✅ Should show `0.0.0.0:27017`, not `127.0.0.1:27017`

## 📝 Current Configuration

Your application is configured to connect to:
```
mongodb://192.168.50.107:27017/
```

This is set in `worklytics_HRMS_backend/config/mongo.js`

## 🔐 With Authentication (Optional)

If you enable authentication on remote MongoDB:

1. **Create user on remote device:**
```powershell
mongosh "mongodb://localhost:27017"
use admin
db.createUser({
  user: "hrms_admin",
  pwd: "HRMS2025$ecurePass!",
  roles: [{role: "root", db: "admin"}]
})
exit
```

2. **Update connection string:**
```powershell
$env:MONGO_URI="mongodb://hrms_admin:HRMS2025$ecurePass!@192.168.50.107:27017/hrms_prod?authSource=admin"
pm2 restart HRMS-backend --update-env
```

