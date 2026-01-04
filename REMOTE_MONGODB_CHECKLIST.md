# MongoDB Remote Connection Checklist

## 🔴 Current Status: Connection Refused

**Target:** `192.168.50.107:27017`
**Status:** Device reachable (ping works), but port 27017 is not accessible

## ✅ Action Required: Configure Remote Device (192.168.50.107)

### Step 1: Verify MongoDB is Running

**On remote device (192.168.50.107):**
```powershell
# Check if MongoDB service is running
Get-Service MongoDB

# If not running, start it
net start MongoDB

# Check if MongoDB process is running
Get-Process mongod -ErrorAction SilentlyContinue
```

### Step 2: Check Current MongoDB Configuration

**On remote device (192.168.50.107):**
```powershell
# Check what MongoDB is listening on
netstat -ano | findstr :27017
```

**Expected (if configured correctly):**
```
TCP    0.0.0.0:27017          0.0.0.0:0              LISTENING       <PID>
```

**If you see this (WRONG - only localhost):**
```
TCP    127.0.0.1:27017        0.0.0.0:0              LISTENING       <PID>
```
→ MongoDB is only listening on localhost, needs to be changed to `0.0.0.0`

### Step 3: Update MongoDB Configuration File

**On remote device (192.168.50.107):**

1. **Locate or create config file:**
   - Default location: `C:\mongodb\mongod.cfg`
   - Or check MongoDB installation directory

2. **Edit `mongod.cfg` file:**
```yaml
storage:
  dbPath: C:\data\db
systemLog:
  destination: file
  path: C:\data\log\mongod.log
  logAppend: true
net:
  port: 27017
  bindIp: 0.0.0.0    # ⚠️ CRITICAL: Must be 0.0.0.0 (not 127.0.0.1)
security:
  authorization: disabled  # Set to 'enabled' if you want authentication
```

**Key Change:** `bindIp: 0.0.0.0` allows connections from any network interface

### Step 4: Restart MongoDB with New Configuration

**On remote device (192.168.50.107):**
```powershell
# Stop MongoDB
net stop MongoDB

# Reinstall with new config (if using service)
mongod --config "C:\mongodb\mongod.cfg" --install

# Start MongoDB
net start MongoDB

# Verify it's listening on 0.0.0.0
netstat -ano | findstr :27017
```

### Step 5: Configure Windows Firewall

**On remote device (192.168.50.107) - Run as Administrator:**
```powershell
# Allow MongoDB port through firewall
New-NetFirewallRule -DisplayName "MongoDB-27017" -Direction Inbound -Protocol TCP -LocalPort 27017 -Action Allow

# Verify rule was created
Get-NetFirewallRule -DisplayName "MongoDB-27017"
```

**Alternative (Manual):**
1. Open Windows Firewall with Advanced Security
2. Inbound Rules → New Rule
3. Port → TCP → Specific local ports: `27017`
4. Allow the connection
5. Apply to all profiles
6. Name: `MongoDB-27017`

### Step 6: Verify Configuration

**On remote device (192.168.50.107):**
```powershell
# Check MongoDB is listening on all interfaces
netstat -ano | findstr :27017

# Should show:
# TCP    0.0.0.0:27017          0.0.0.0:0              LISTENING       <PID>
```

### Step 7: Test from Remote Device Itself

**On remote device (192.168.50.107):**
```powershell
# Test local connection
mongosh "mongodb://localhost:27017"

# Test with network IP
mongosh "mongodb://192.168.50.107:27017"
```

Both should work if configured correctly.

## ✅ Test from Your Device

**After completing steps above, test from your device:**
```powershell
# Test network connectivity
Test-NetConnection -ComputerName 192.168.50.107 -Port 27017

# Should show: TcpTestSucceeded: True

# Test MongoDB connection
cd C:\shivank\worklytics_HRMSAsset_NextJS\worklytics_HRMS_backend
npm run test-mongodb
```

## 🔍 Troubleshooting

### Issue: Still Connection Refused

**Checklist:**
- [ ] MongoDB service is running? `Get-Service MongoDB`
- [ ] `bindIp: 0.0.0.0` in mongod.cfg? (not `127.0.0.1`)
- [ ] MongoDB restarted after config change?
- [ ] Firewall rule created? `Get-NetFirewallRule -DisplayName "MongoDB-27017"`
- [ ] `netstat` shows `0.0.0.0:27017`? (not `127.0.0.1:27017`)

### Issue: Cannot Find mongod.cfg

**Locations to check:**
```powershell
# Common locations
C:\mongodb\mongod.cfg
C:\Program Files\MongoDB\Server\<version>\bin\mongod.cfg
C:\data\mongod.cfg

# Find MongoDB installation
where mongod
```

**If file doesn't exist, create it:**
```powershell
# Create directory
New-Item -ItemType Directory -Path "C:\mongodb" -Force

# Create config file (use the YAML content from Step 3)
```

### Issue: MongoDB Won't Start

**Check logs:**
```powershell
# Check MongoDB logs
type C:\data\log\mongod.log

# Check Windows Event Viewer
eventvwr.msc
```

### Issue: Firewall Rule Not Working

**Try disabling firewall temporarily to test:**
```powershell
# Temporarily disable firewall (for testing only)
Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False

# Test connection
# Then re-enable firewall
Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True
```

## 📋 Quick Command Reference

**On Remote Device (192.168.50.107):**
```powershell
# Check service
Get-Service MongoDB

# Check listening ports
netstat -ano | findstr :27017

# Check firewall rules
Get-NetFirewallRule -DisplayName "MongoDB*"

# Restart MongoDB
net stop MongoDB
net start MongoDB

# Test local connection
mongosh "mongodb://localhost:27017"
```

**On Your Device:**
```powershell
# Test network
Test-NetConnection -ComputerName 192.168.50.107 -Port 27017

# Test MongoDB
cd worklytics_HRMS_backend
npm run test-mongodb

# Check backend logs
pm2 logs HRMS-backend
```

## 🎯 Success Indicators

✅ **Connection successful when:**
- `Test-NetConnection` shows `TcpTestSucceeded: True`
- `npm run test-mongodb` shows "Connection successful!"
- `pm2 logs HRMS-backend` shows "✅ [mongo] Connected to MongoDB"
- No "ECONNREFUSED" errors in logs

## 📞 Need Help?

If still having issues:
1. Share output of `netstat -ano | findstr :27017` from remote device
2. Share MongoDB config file content (remove passwords if any)
3. Share firewall rule status: `Get-NetFirewallRule -DisplayName "MongoDB*"`
4. Check MongoDB logs: `type C:\data\log\mongod.log`

