# Production Setup Checklist

## ✅ Pre-Setup Requirements

- [ ] Node.js installed (v14+)
- [ ] MongoDB installed and service running
- [ ] PM2 installed globally (`npm install -g pm2`)
- [ ] All npm dependencies installed (`npm install` in both backend and frontend)

## 📝 MongoDB Configuration

- [ ] Create directory: `C:\data\db` (for MongoDB data)
- [ ] Create directory: `C:\data\log` (for MongoDB logs)
- [ ] Create directory: `C:\mongodb` (for MongoDB config)
- [ ] Copy `mongod.cfg` from project root to `C:\mongodb\mongod.cfg`
- [ ] Install MongoDB as Windows service:
  ```powershell
  net stop MongoDB
  mongod --config "C:\mongodb\mongod.cfg" --install
  net start MongoDB
  ```
- [ ] Create admin user in MongoDB:
  ```powershell
  mongosh "mongodb://192.168.50.107:27017"
  use admin
  db.createUser({
    user: "hrms_admin",
    pwd: "HRMS2025$ecurePass!",
    roles: [{role: "root", db: "admin"}]
  })
  exit
  ```
- [ ] Configure Windows Firewall:
  ```powershell
  New-NetFirewallRule -DisplayName "MongoDB-27017" -Direction Inbound -Protocol TCP -LocalPort 27017 -Action Allow
  ```
- [ ] Test MongoDB connection:
  ```powershell
  mongosh "mongodb://hrms_admin:HRMS2025$ecurePass!@192.168.50.107:27017/hrms_prod?authSource=admin"
  ```

## 🔧 Backend Setup

- [ ] Navigate to backend directory:
  ```powershell
  cd C:\shivank\worklytics_HRMSAsset_NextJS\worklytics_HRMS_backend
  ```
- [ ] Verify `ecosystem.config.js` exists
- [ ] Create logs directory:
  ```powershell
  mkdir logs
  ```
- [ ] Start backend with PM2:
  ```powershell
  npm run prod:backend
  ```
- [ ] Save PM2 configuration:
  ```powershell
  pm2 save
  ```
- [ ] Setup PM2 startup (optional):
  ```powershell
  pm2 startup
  # Follow the instructions shown
  ```
- [ ] Verify backend is running:
  ```powershell
  pm2 list
  pm2 logs HRMS-backend --lines 20
  ```
- [ ] Test backend health endpoint:
  ```powershell
  curl http://localhost:5008/api/health
  # Or open in browser: http://localhost:5008/api/health
  ```

## 🎨 Frontend Setup

- [ ] Navigate to frontend directory:
  ```powershell
  cd C:\shivank\worklytics_HRMSAsset_NextJS\worklytics_HRMS_frontend
  ```
- [ ] Build production version:
  ```powershell
  npm run build
  ```
- [ ] Start production server:
  ```powershell
  npm run start -- -p 4000
  ```
- [ ] Test frontend:
  ```powershell
  # Open in browser: http://localhost:4000
  ```

## 🌐 Network Configuration

- [ ] Find your LAN IP address:
  ```powershell
  ipconfig
  # Note your IPv4 address (e.g., 192.168.1.100)
  ```
- [ ] Test network connectivity:
  ```powershell
  cd worklytics_HRMS_backend
  powershell -ExecutionPolicy Bypass -File .\test-network.ps1
  ```
- [ ] Test from another machine:
  - Frontend: `http://<YOUR_IP>:4000`
  - Backend: `http://<YOUR_IP>:5008/api/health`
  - MongoDB: `mongodb://hrms_admin:HRMS2025$ecurePass!@<YOUR_IP>:27017/hrms_prod?authSource=admin`

## 🔍 Verification Tests

- [ ] Backend health check returns 200 OK
- [ ] Frontend loads without errors
- [ ] MongoDB connection works from backend
- [ ] PM2 process is running and stable
- [ ] All ports are accessible (5008, 4000, 27017)
- [ ] Network access works from other machines

## 📚 Documentation

- [ ] Read `PRODUCTION_SETUP.md` for detailed guide
- [ ] Read `QUICK_START_PRODUCTION.md` for quick reference
- [ ] Keep `SETUP_CHECKLIST.md` for future reference

## 🚨 Common Issues & Solutions

### Issue: PM2 "Script not found: PORT=5008"
**Solution:** Use `npm run prod:backend` instead of command-line arguments

### Issue: MongoDB connection failed
**Solution:** 
1. Check MongoDB service: `net start MongoDB`
2. Verify admin user exists
3. Check connection string includes `authSource=admin`

### Issue: Port already in use
**Solution:**
```powershell
netstat -ano | findstr :<PORT>
taskkill /PID <PID> /F
```

### Issue: Frontend build fails
**Solution:**
```powershell
rm -r .next
npm run build
```

## 📞 Support

If you encounter issues:
1. Check PM2 logs: `pm2 logs HRMS-backend`
2. Check MongoDB logs: `type C:\data\log\mongod.log`
3. Run network test: `.\test-network.ps1`
4. Review `PRODUCTION_SETUP.md` troubleshooting section

