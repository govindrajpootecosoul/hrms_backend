# Worklytics HRMS Backend

## 🚀 Quick Start

### Automatic Setup (Recommended)
Just start the server - it will automatically create the database and tables!

```bash
npm install
npm run dev
```

That's it! The server will:
- ✅ Auto-create `worklytics_hrms` database
- ✅ Auto-create `users` table
- ✅ Start on http://localhost:5000

## 📋 Database Configuration

- **Host**: 192.168.50.29
- **Port**: 3306
- **User**: apiuser
- **Password**: Thrive@2910
- **Database**: worklytics_hrms (auto-created)
- **Pool Size**: 12

## 🛠️ Available Commands

```bash
# Start server (with auto-setup)
npm run dev

# Manual database setup (optional)
npm run setup-db

# Test database connection
npm run test-connection

# Production start
npm start
```

## 📡 API Endpoints

### POST /api/auth/signup
Create new user account
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "1234567890",
  "role": "admin",
  "password": "password123"
}
```

### POST /api/auth/login
Login user
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

### GET /api/auth/verify
Verify JWT token
```
Headers: Authorization: Bearer <token>
```

## 🔧 Environment Variables (Optional)

Create `.env` file to override defaults:

```env
DB_HOST=192.168.50.29
DB_PORT=3306
DB_USER=apiuser
DB_PASSWORD=Thrive@2910
DB_NAME=worklytics_hrms
DB_POOL_SIZE=12
JWT_SECRET=your-secret-key-change-in-production
PORT=5000
```

## 📚 Documentation

- `AUTO_SETUP.md` - Auto-setup feature details
- `SETUP_DATABASE.md` - Manual setup guide
- `DATABASE_CONFIG.md` - Database configuration

## ✅ Features

- ✅ Automatic database & table creation
- ✅ JWT authentication
- ✅ Password hashing with bcrypt
- ✅ Input validation
- ✅ Error handling
- ✅ CORS enabled
