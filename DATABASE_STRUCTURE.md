# Database Structure - Company-Specific Databases

This document outlines all the company-specific databases that are created in the system.

## Database Naming Convention

All databases follow the pattern: `{company}_{base_database_name}`

Where:
- `{company}` is normalized to lowercase with underscores (e.g., "Ecosoul Home" → "ecosoul", "Thrive" → "thrive")
- `{base_database_name}` is the base database name for each module

## Complete Database List

### Shared Databases (Not Company-Specific)
- **Employees_List** - Contains employee collections (Thrive_Employees, Ecosoul_Employees)
  - Used for: User authentication and employee management
  - Collections: `Thrive_Employees`, `Ecosoul_Employees`

### Company-Specific Databases

#### For Ecosoul Home Company:
1. **ecosoul_asset_tracker** - Asset tracking database
   - Collections: `assets`, `asset_categories`, `asset_assignments`, `asset_history`, `companies`

2. **ecosoul_hrms** - HRMS (Human Resource Management System) database
   - Collections: `employees`, `attendance`, `leaves`, `departments`, `designations`, `recruitment`

3. **ecosoul_finance** - Finance portal database
   - Collections: `invoices`, `transactions`, `expenses`, `budgets`, `financial_reports`

4. **ecosoul_query_tracker** - Query tracker database
   - Collections: `queries`, `users`, `reports`

5. **ecosoul_Employee** - Employee portal database
   - Collections: `employee_checkins`, `portal_dashboard`, `portal_attendance`, `portal_requests`, `portal_org`, `portal_reports`

#### For Thrive Company:
1. **thrive_asset_tracker** - Asset tracking database
   - Collections: `assets`, `asset_categories`, `asset_assignments`, `asset_history`, `companies`

2. **thrive_hrms** - HRMS (Human Resource Management System) database
   - Collections: `employees`, `attendance`, `leaves`, `departments`, `designations`, `recruitment`

3. **thrive_finance** - Finance portal database
   - Collections: `invoices`, `transactions`, `expenses`, `budgets`, `financial_reports`

4. **thrive_query_tracker** - Query tracker database
   - Collections: `queries`, `users`, `reports`

5. **thrive_Employee** - Employee portal database
   - Collections: `employee_checkins`, `portal_dashboard`, `portal_attendance`, `portal_requests`, `portal_org`, `portal_reports`

## Database Mapping

| Module | Base Database Name | Ecosoul Database | Thrive Database |
|--------|-------------------|------------------|-----------------|
| Asset Tracker | `asset_tracker` | `ecosoul_asset_tracker` | `thrive_asset_tracker` |
| HRMS | `hrms` | `ecosoul_hrms` | `thrive_hrms` |
| Finance | `finance` | `ecosoul_finance` | `thrive_finance` |
| Query Tracker | `query_tracker` | `ecosoul_query_tracker` | `thrive_query_tracker` |
| Employee Portal | `Employee` | `ecosoul_Employee` | `thrive_Employee` |
| Employee Portal (HRMS) | `hrms` | `ecosoul_hrms` | `thrive_hrms` |
| Login (Shared) | `Employees_List` | `Employees_List` | `Employees_List` |

## How It Works

1. **Company Selection**: When a user logs in, the system determines their company based on their email domain:
   - `@thrivebrands.ai` → Thrive
   - `@ecosoulhome.com` → Ecosoul Home

2. **Database Selection**: When accessing any portal, the system:
   - Gets the selected company from `sessionStorage` (for frontend) or request headers (for API)
   - Uses `getCompanyDatabaseName(module, company)` to get the correct database name
   - Connects to the company-specific database

3. **Data Isolation**: Each company's data is completely isolated in separate databases, ensuring:
   - No data leakage between companies
   - Independent scaling and management
   - Clear separation of concerns

## Configuration

Database names are configured in:
- **Backend**: `worklytics_HRMS_backend/config/database.config.js`
- **Frontend**: `worklytics_HRMS_frontend/src/lib/config/database.config.js`

To change base database names, update the `MONGODB_CONFIG.databases` object in these files.

## Usage Examples

### Backend (Node.js)
```javascript
const { getCompanyDatabaseName } = require('./config/database.config');

// Get Ecosoul's asset tracker database
const dbName = getCompanyDatabaseName('assetTracker', 'Ecosoul Home');
// Returns: 'ecosoul_asset_tracker'

// Get Thrive's HRMS database
const hrmsDb = getCompanyDatabaseName('hrms', 'Thrive');
// Returns: 'thrive_hrms'
```

### Frontend (Next.js)
```javascript
import { getCompanyDatabaseName } from '@/lib/config/database.config';

// Get company from sessionStorage
const company = sessionStorage.getItem('selectedCompany');

// Get company-specific database name
const dbName = getCompanyDatabaseName('assetTracker', company);
// Returns: 'ecosoul_asset_tracker' or 'thrive_asset_tracker'
```

## Notes

- All databases are created automatically when first accessed
- Collections are created automatically when first document is inserted
- The `Employees_List` database is shared and contains company-specific collections
- Company names are case-insensitive and normalized automatically

