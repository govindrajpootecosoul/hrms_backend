# Auto Database Setup

## ✅ Automatic Setup Enabled!

The server now **automatically creates the database and tables** when you start it!

## How It Works

When you run `npm run dev` or `npm start`, the server will:
1. ✅ Automatically create `worklytics_hrms` database (if it doesn't exist)
2. ✅ Automatically create `users` table (if it doesn't exist)
3. ✅ Start the server

**No manual setup needed!** 🎉

## Usage

### Just Start the Server
```bash
npm run dev
```

You'll see:
```
🔧 Auto-setting up database...
✅ Database "worklytics_hrms" ready
✅ Users table ready
🚀 Server running on http://localhost:5008
✅ Database connected successfully
```

### Manual Setup (Optional)
If you want to setup manually first:
```bash
npm run setup-db
```

### Test Connection
```bash
npm run test-connection
```

## Requirements

The auto-setup requires:
- MySQL server running on 192.168.50.29:3306
- User `apiuser` with password `Thrive@2910`
- User must have CREATE DATABASE privileges

If auto-setup fails, you'll see a warning but the server will still start. You can then:
1. Run `npm run setup-db` manually
2. Or create database/tables in phpMyAdmin

## Configuration

All settings are in `config/database.js` or can be overridden with `.env`:

```env
DB_HOST=192.168.50.29
DB_PORT=3306
DB_USER=apiuser
DB_PASSWORD=Thrive@2910
DB_NAME=worklytics_hrms
```

