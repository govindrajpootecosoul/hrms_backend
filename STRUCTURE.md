# Backend Project Structure

This backend is organized by portal to make the code structure easier to understand and maintain.

## Directory Structure

```
worklytics_HRMS_backend/
├── shared/                    # Shared code used by all portals
│   └── routes/
│       └── auth.js           # Authentication routes (login, signup, verify)
│
├── hrms-portal/              # HRMS Portal backend
│   └── routes/
│       └── index.js          # HRMS-specific routes
│
├── asset-tracker-portal/     # Asset Tracker Portal backend
│   └── routes/
│       └── index.js          # Asset Tracker-specific routes
│
├── finance-portal/           # Finance Portal backend
│   └── routes/
│       └── index.js          # Finance-specific routes
│
├── employee-portal/          # Employee Portal backend
│   └── routes/
│       └── index.js          # Employee Self-Service-specific routes
│
├── config/                   # Configuration files
│   └── database.js           # Database connection configuration
│
├── database/                 # Database scripts
│   ├── create-database.sql
│   └── schema.sql
│
├── utils/                    # Utility functions
│   └── autoSetup.js          # Auto database setup utility
│
└── server.js                 # Main server file
```

## API Routes

### Shared Routes (All Portals)
- `POST /api/auth/signup` - User signup
- `POST /api/auth/login` - User login
- `GET /api/auth/verify` - Verify JWT token

### HRMS Portal Routes
- `GET /api/hrms/employees` - Get employees list
- `GET /api/hrms/attendance` - Get attendance data
- `GET /api/hrms/leaves` - Get leaves data

### Asset Tracker Portal Routes
- `GET /api/asset-tracker/assets` - Get assets list
- `GET /api/asset-tracker/assets/:id` - Get asset by ID

### Finance Portal Routes
- `GET /api/finance/dashboard` - Get finance dashboard data
- `POST /api/finance/invoices/process` - Process invoices

### Employee Portal Routes
- `GET /api/employee/profile` - Get employee profile
- `GET /api/employee/attendance` - Get employee attendance
- `GET /api/employee/leaves` - Get employee leaves

## Adding New Routes

When adding new routes for a specific portal:

1. Add the route handler in the corresponding portal's `routes/index.js` file
2. Export the router from that file
3. The route will be automatically available at `/api/{portal-name}/{route-path}`

Example for HRMS Portal:
```javascript
// hrms-portal/routes/index.js
router.get('/recruitment', async (req, res) => {
  // Your route handler
});
// This will be available at: GET /api/hrms/recruitment
```

## Notes

- All portal-specific routes are prefixed with `/api/{portal-name}`
- Shared routes (like auth) are available at `/api/{shared-route-name}`
- Each portal folder can be expanded to include controllers, models, middleware, etc. as needed


