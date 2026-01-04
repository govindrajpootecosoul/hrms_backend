# MongoDB Network Connection Setup Guide

## 🌐 Connecting to MongoDB on Remote Device (192.168.50.107:27017)

### Step 1: Configure MongoDB on Remote Device (192.168.50.107)

The MongoDB server on the remote device needs to be configured to accept network connections.

#### Option A: Using mongod.cfg (Recommended)

1. **On the remote device (192.168.50.107)**, create or update `C:\mongodb\mongod.cfg`:

```yaml
storage:
  dbPath: C:\data\db
systemLog:
  destination: file
  path: C:\data\log\mongod.log
  logAppend: true
net:
  port: 27017
  bindIp: 0.0.0.0  # Allow connections from all network interfaces
security:
  authorization: disabled  # Set to 'enabled' if you want authentication
```

**Important:** `bindIp: 0.0.0.0` allows MongoDB to accept connections from any network interface.

2. **Restart MongoDB service on remote device:**

```powershell
# On remote device (192.168.50.107)
net stop MongoDB
mongod --config "C:\mongodb\mongod.cfg" --install
net start MongoDB
```

#### Option B: Command Line (Temporary)

If you want to test without changing the config file:

```powershell
# On remote device (192.168.50.107)
mongod --bind_ip 0.0.0.0 --port 27017
```

### Step 2: Configure Windows Firewall on Remote Device

**On the remote device (192.168.50.107)**, allow MongoDB port through firewall:

```powershell
# Run as Administrator on remote device
New-NetFirewallRule -DisplayName "MongoDB-27017" -Direction Inbound -Protocol TCP -LocalPort 27017 -Action Allow
```

Or manually:
1. Open Windows Firewall
2. Advanced Settings
3. Inbound Rules → New Rule
4. Port → TCP → Specific local ports: 27017
5. Allow the connection
6. Apply to all profiles
7. Name: "MongoDB-27017"

### Step 3: Verify MongoDB is Listening on Network

**On the remote device (192.168.50.107)**, check if MongoDB is listening:

```powershell
netstat -ano | findstr :27017
```

You should see something like:
```
TCP    0.0.0.0:27017          0.0.0.0:0              LISTENING       <PID>
```

If you only see `127.0.0.1:27017`, MongoDB is only listening on localhost and won't accept network connections.

### Step 4: Test Connection from Your Device

**On your current device**, test the connection:

```powershell
# Test network connectivity
Test-NetConnection -ComputerName 192.168.50.107 -Port 27017

# Test MongoDB connection
mongosh "mongodb://192.168.50.107:27017"
```

### Step 5: Update Application Configuration

The application is already configured to use `192.168.50.107:27017`. Verify the connection:

```powershell
cd C:\shivank\worklytics_HRMSAsset_NextJS\worklytics_HRMS_backend
pm2 restart HRMS-backend
pm2 logs HRMS-backend
```

### Step 6: With Authentication (Optional)

If you want to enable authentication on the remote MongoDB:

1. **On remote device**, create admin user:

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

2. **Update mongod.cfg on remote device:**

```yaml
security:
  authorization: enabled
```

3. **Restart MongoDB on remote device:**

```powershell
net stop MongoDB
net start MongoDB
```

4. **Update connection string in your application:**

Set environment variable:
```powershell
$env:MONGO_URI="mongodb://hrms_admin:HRMS2025$ecurePass!@192.168.50.107:27017/hrms_prod?authSource=admin"
```

Or update `config/mongo.js`:
```javascript
const MONGO_URI = process.env.MONGO_URI || 'mongodb://hrms_admin:HRMS2025$ecurePass!@192.168.50.107:27017/hrms_prod?authSource=admin';
```

## 🔍 Troubleshooting

### Issue: Connection Timeout

**Symptoms:** `TcpTestSucceeded: False`

**Solutions:**
1. Check if MongoDB is running on remote device:
   ```powershell
   # On remote device
   net start MongoDB
   ```

2. Check if port 27017 is open:
   ```powershell
   # On remote device
   netstat -ano | findstr :27017
   ```

3. Check firewall rules:
   ```powershell
   # On remote device
   Get-NetFirewallRule -DisplayName "MongoDB-27017"
   ```

4. Verify bindIp configuration:
   - Must be `0.0.0.0` or include the network interface IP
   - Not just `127.0.0.1`

### Issue: Authentication Failed

**Symptoms:** `MongoServerError: Authentication failed`

**Solutions:**
1. If authentication is not enabled, use connection string without credentials:
   ```
   mongodb://192.168.50.107:27017/
   ```

2. If authentication is enabled, verify credentials:
   ```powershell
   mongosh "mongodb://hrms_admin:HRMS2025$ecurePass!@192.168.50.107:27017/admin"
   ```

### Issue: Connection Refused

**Symptoms:** Connection refused errors

**Solutions:**
1. MongoDB service not running on remote device
2. Wrong IP address
3. Port blocked by firewall
4. MongoDB not bound to network interface

### Issue: Network Unreachable

**Symptoms:** Cannot ping the device

**Solutions:**
1. Verify both devices are on the same network
2. Check IP address: `ipconfig` on remote device
3. Verify network connectivity: `ping 192.168.50.107`

## 📋 Quick Checklist

**On Remote Device (192.168.50.107):**
- [ ] MongoDB service is running
- [ ] `mongod.cfg` has `bindIp: 0.0.0.0`
- [ ] Firewall allows port 27017
- [ ] `netstat` shows MongoDB listening on `0.0.0.0:27017`
- [ ] (Optional) Authentication configured if needed

**On Your Device:**
- [ ] Can ping 192.168.50.107
- [ ] Can connect to port 27017: `Test-NetConnection -ComputerName 192.168.50.107 -Port 27017`
- [ ] Application configured with correct IP
- [ ] Backend restarted after configuration change

## 🔗 Connection Strings

**Without Authentication:**
```
mongodb://192.168.50.107:27017/
```

**With Authentication:**
```
mongodb://hrms_admin:HRMS2025$ecurePass!@192.168.50.107:27017/hrms_prod?authSource=admin
```

## 📝 Environment Variables

You can also set the connection via environment variable:

```powershell
# Without authentication
$env:MONGO_URI="mongodb://192.168.50.107:27017/"

# With authentication
$env:MONGO_URI="mongodb://hrms_admin:HRMS2025$ecurePass!@192.168.50.107:27017/hrms_prod?authSource=admin"
```

Then restart PM2:
```powershell
pm2 restart HRMS-backend --update-env
```

