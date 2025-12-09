# Grant Database Privileges

If you get "Access denied" or "Unknown database" errors, you may need to grant privileges to the `apiuser`.

## Quick Fix - Run in phpMyAdmin

1. Go to: http://192.168.50.29/
2. Login: `root` / `Thrive@2910` (or any admin user)
3. Click **SQL** tab
4. Run this SQL:

```sql
-- Grant all privileges on worklytics_hrms database
GRANT ALL PRIVILEGES ON worklytics_hrms.* TO 'apiuser'@'%';

-- Or grant CREATE DATABASE privilege (if you want apiuser to create databases)
GRANT CREATE ON *.* TO 'apiuser'@'%';

-- Apply changes
FLUSH PRIVILEGES;
```

## Verify Privileges

Run this SQL to check:

```sql
SHOW GRANTS FOR 'apiuser'@'%';
```

## After Granting Privileges

Run the test again:
```bash
npm run test-connection
```

Or just start the server (it will auto-create):
```bash
npm run dev
```

