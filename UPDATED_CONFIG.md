# Updated Database Configuration

## New Configuration
- **Host**: 192.168.50.29
- **Port**: 3306
- **User**: apiuser
- **Password**: Thrive@2910
- **Database**: datahive_esh
- **Pool Size**: 12

## Setup Steps

### 1. Create Users Table
The database `datahive_esh` already exists. You just need to create the `users` table.

**Option A: Using phpMyAdmin**
1. Go to: http://192.168.50.29/
2. Login with: `apiuser` / `Thrive@2910` (or `root` / `Thrive@2910`)
3. Select database: `datahive_esh`
4. Click **SQL** tab
5. Run the SQL from `database/create-users-table.sql`

**Option B: Using SQL File**
Run this SQL in phpMyAdmin:

```sql
USE datahive_esh;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(20) NOT NULL,
  role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 2. Verify Connection
```bash
npm run test-connection
```

### 3. Start Server
```bash
npm run dev
```

## Environment Variables (Optional)
Create `.env` file to override defaults:

```env
DB_HOST=192.168.50.29
DB_PORT=3306
DB_USER=apiuser
DB_PASSWORD=Thrive@2910
DB_NAME=datahive_esh
DB_POOL_SIZE=12
JWT_SECRET=your-secret-key-change-in-production
PORT=5000
```

