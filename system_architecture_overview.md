# HR-FFI-SYSTEM - Complete System Architecture Overview

## Table of Contents

1. [System Overview](#system-overview)
2. [Technology Stack](#technology-stack)
3. [User Roles and Permissions](#user-roles-and-permissions)
4. [Database Architecture](#database-architecture)
5. [Backend Architecture](#backend-architecture)
6. [Frontend Architecture](#frontend-architecture)
7. [API Design](#api-design)
8. [Security Architecture](#security-architecture)
9. [System Diagrams](#system-diagrams)
10. [Recent Work](#recent-work)

---

## System Overview

**HR-FFI-SYSTEM** is a comprehensive Human Resources Management System designed for FFI organizations to manage:

- **Employee Data Management**: Complete employee lifecycle from onboarding to offboarding
- **Payroll Processing**: Monthly payroll runs with automated calculations and payslip generation
- **Leave Management**: Multi-tier leave request approval workflow (Employee → Manager → HR)
- **User Administration**: Role-based access control with System Admin, HR Manager, Manager, and Employee roles
- **Audit Logging**: Complete audit trail for compliance and security
- **Announcements**: Organization-wide communication system
- **Attendance Tracking**: Employee attendance and time management

### Key Business Features

- **Excel Import**: Bulk employee data import with all-or-nothing validation
- **Document Expiry Tracking**: Passport, ID, and Health Card expiry notifications
- **Multi-tier Leave Approval**: Manager pre-approval followed by HR approval
- **Payroll Export**: CSV, XLSX, and PDF export formats
- **Role-based Dashboards**: Customized views for Admin, HR, Managers, and Employees

---

## Technology Stack

### Backend
- **Framework**: Django 5.2 (Python)
- **Database**: PostgreSQL
- **Authentication**: JWT (SimpleJWT) with token blacklisting
- **API**: Django REST Framework (DRF)
- **File Storage**: Private upload storage for sensitive documents
- **Email**: Resend API integration
- **Filtering**: django-filter for querysets
- **CORS**: django-cors-headers

### Frontend
- **Framework**: React 18+ with TypeScript
- **Build Tool**: Vite
- **Routing**: React Router v6
- **State Management**: Zustand
- **UI Components**: Ant Design (antd)
- **HTTP Client**: Axios
- **Styling**: CSS with Ant Design theme

### DevOps
- **Version Control**: Git
- **Package Management**: npm (frontend), pip (backend)
- **Development**: Hot reload on both frontend and backend

---

## User Roles and Permissions

### 1. System Admin (SystemAdmin)
**Full system access including:**
- User management (create, disable, activate users)
- Role assignment
- Password resets
- User invitations
- System settings configuration
- Full audit log access
- Can view announcements

### 2. HR Manager (HRManager)
**HR operations access:**
- Employee management (CRUD operations)
- Department, Position, Task Group, Sponsor management
- Employee Excel import
- Payroll processing (create, review, finalize, export)
- Leave request approval (final decision)
- Leave type management
- Announcement creation and management
- Document expiry monitoring
- Attendance management

### 3. Manager
**Team management access:**
- View team members
- Pre-approve/reject leave requests for direct reports
- View team announcements
- Dashboard with team insights

### 4. Employee
**Self-service access:**
- View own profile (read-only)
- View payslips and download PDFs
- Submit leave requests
- View leave balance
- View employment status
- Mark attendance
- View announcements

---

## Database Architecture

### Core Tables

#### **User Management**
- **`User`** (accounts.User): Custom user model with email-based authentication
  - Fields: `email`, `full_name`, `password`, `is_active`, `date_joined`
  - Uses email as USERNAME_FIELD (no username)
- **`LoginAttempt`**: Tracks failed login attempts for security
  - Fields: `email`, `ip_address`, `failed_count`, `locked_until`

#### **Employee Data**
- **`EmployeeProfile`** (employees.EmployeeProfile): Core employee information
  - Auto-generated `employee_id` (e.g., EMP-00123)
  - Personal: `full_name`, `nationality`, `date_of_birth`, `mobile`
  - Documents: `passport_no`, `passport_expiry`, `national_id`, `id_expiry`, `health_card`, `health_card_expiry`
  - Employment: `hire_date`, `contract_date`, `contract_expiry`, `employment_status`
  - Salary: `basic_salary`, `transportation_allowance`, `accommodation_allowance`, `telephone_allowance`, `petrol_allowance`, `other_allowance`, `total_salary`
  - Relationships: Department, Position, TaskGroup, Sponsor (ForeignKeys)
  - Links to `User` (OneToOne, optional)

#### **HR Reference Data**
- **`Department`**: Organization departments
- **`Position`**: Job positions
- **`TaskGroup`**: Task groupings
- **`Sponsor`**: Sponsor codes for employees

#### **Payroll**
- **`PayrollRun`**: Monthly payroll cycle
  - Fields: `year`, `month`, `status` (DRAFT/COMPLETED/PAID/CANCELLED), `total_net`
  - Unique constraint on (year, month)
- **`PayrollRunItem`**: Individual employee payroll calculation
  - Fields: `employee_id`, `basic_salary`, `total_allowances`, `total_deductions`, `net_salary`
- **`Payslip`**: Employee payslip records
  - Detailed allowance breakdown
  - Linked to PayrollRun and Employee

#### **Leave Management**
- **`LeaveType`**: Types of leave (Annual, Sick, etc.)
  - Fields: `name`, `code`, `is_paid`, `annual_quota`, `allow_carry_over`
- **`LeaveRequest`**: Employee leave applications
  - Status workflow: SUBMITTED → PENDING_MANAGER → PENDING_HR → APPROVED/REJECTED
  - Manager decision: `manager_decision_by`, `manager_decision_at`, `manager_decision_note`
  - HR decision: `decided_by`, `decided_at`, `hr_decision_note`
- **`LeaveBalanceSnapshot`**: Annual leave balance tracking
- **`LeaveBalanceAdjustment`**: Manual balance corrections

#### **Administration**
- **`AuditLog`**: System-wide audit trail
  - Fields: `user`, `action`, `entity_type`, `entity_id`, `ip_address`, `timestamp`
- **`Invite`**: User invitation system
  - Fields: `email`, `role`, `status`, `expires_at`
- **`Announcement`**: System announcements
  - Fields: `title`, `content`, `priority`, `target_roles`, `is_pinned`

#### **Import Tracking**
- **`EmployeeImport`**: Excel import history
  - Fields: `uploader`, `original_filename`, `status`, `row_count`, `inserted_rows`, `error_summary`

#### **Attendance**
- **`AttendanceRecord`**: Daily attendance tracking
  - Fields: `employee`, `date`, `check_in`, `check_out`, `status`

### Database Diagram

See [DB.png](file:///d:/HR-FFI-SYSTEM/Diagrams/DB.png) for the complete entity-relationship diagram showing all tables and relationships.

---

## Backend Architecture

### Django Project Structure

```
Backend/
├── config/                 # Main project configuration
│   ├── settings.py        # Django settings (JWT, CORS, DB config)
│   ├── urls.py            # Root URL configuration
│   └── wsgi.py
├── accounts/              # User authentication & management
│   ├── models.py          # User, LoginAttempt
│   ├── views.py           # Login, logout, change password
│   └── serializers.py
├── admin_portal/          # System Admin functionality
│   ├── views.py           # User management, settings, summary
│   └── permissions.py     # IsSystemAdmin permission
├── employees/             # Employee management
│   ├── models.py          # EmployeeProfile, EmployeeImport
│   ├── views.py           # CRUD, Excel import, expiry dashboard
│   └── excel_import.py    # Excel validation & import logic
├── hr_reference/          # Reference data (Dept, Position, etc.)
│   ├── models.py          # Department, Position, TaskGroup, Sponsor
│   └── views.py
├── payroll/               # Payroll processing
│   ├── models.py          # PayrollRun, PayrollRunItem, Payslip
│   ├── views.py           # Create, finalize, export
│   └── exports.py         # CSV, XLSX, PDF generation
├── leaves/                # Leave management
│   ├── models.py          # LeaveType, LeaveRequest, LeaveBalance
│   ├── views.py           # Submit, approve/reject (Manager & HR)
│   └── permissions.py     # IsManagerOf, IsHRManager
├── attendance/            # Attendance tracking
├── announcements/         # Announcements system
├── audit/                 # Audit logging
├── invites/               # User invitation system
└── core/                  # Shared utilities
    ├── pagination.py      # Standard pagination (25 items/page)
    ├── exceptions.py      # Custom exception handler
    └── permissions.py     # Role-based permissions
```

### Key Backend Apps

#### 1. **accounts** - Authentication
- JWT-based authentication with access + refresh tokens
- Token blacklisting on logout
- Rate limiting (10 login attempts per minute)
- Account lockout after 5 failed attempts (15 min lockout)
- Password validation (min length, complexity, common passwords)

#### 2. **employees** - Employee Management
- Auto-generated employee IDs
- Excel import with comprehensive validation:
  - File size limit (5-10MB)
  - Row limit (5,000 rows)
  - Column validation (exact match required)
  - All-or-nothing database transaction
  - Error file generation with row-level errors
- Document expiry dashboard (30-day lookback)
- Salary component tracking

#### 3. **payroll** - Payroll Processing
- Monthly payroll runs (unique per year/month)
- Automated PayrollRunItem generation from active employees
- Automated Payslip creation on finalization
- Export formats: CSV, XLSX, PDF
- Status workflow: DRAFT → COMPLETED → PAID
- Throttling on finalize, generate, export operations

#### 4. **leaves** - Leave Management
- Multi-tier approval workflow:
  1. Employee submits → SUBMITTED
  2. Manager reviews → PENDING_HR (approved) or REJECTED
  3. HR finalizes → APPROVED or REJECTED
- Leave balance tracking with annual quotas
- Carry-over support for unused leave
- Leave types with paid/unpaid flag
- Manager can only review own team members

#### 5. **admin_portal** - System Administration
- User CRUD operations
- Role assignment (SystemAdmin, HRManager, Manager, Employee)
- Password reset (temporary password or reset link)
- System settings management
- Audit log viewing and export

---

## Frontend Architecture

### React Project Structure

```
FrontEnd/src/
├── pages/                 # Page components (route endpoints)
│   ├── admin/            # System Admin pages
│   ├── hr/               # HR Manager pages
│   │   ├── dashboard/
│   │   ├── employees/
│   │   ├── import/
│   │   ├── payroll/
│   │   ├── leave/
│   │   └── announcements/
│   ├── manager/          # Manager pages
│   ├── employee/         # Employee self-service pages
│   │   ├── payslips/
│   │   └── leave/
│   └── shared/           # Shared pages
├── components/           # Reusable UI components
│   ├── AnnouncementWidget.tsx
│   ├── Header.tsx
│   └── ...
├── layouts/              # Layout wrappers
│   └── BaseLayout.tsx   # Main app layout with header/sidebar
├── routes/               # Routing configuration
│   ├── routes.tsx       # Route definitions
│   ├── RequireAuth.tsx  # Authentication guard
│   └── RequireRole.tsx  # Role-based access guard
├── services/             # API service layer
│   └── api/             # API clients
│       ├── authApi.ts
│       ├── employeeApi.ts
│       ├── payrollApi.ts
│       ├── leaveApi.ts
│       ├── announcementApi.ts
│       └── ...
├── stores/               # Zustand state management
│   └── authStore.ts     # Auth state (user, token, role)
├── types/                # TypeScript type definitions
└── utils/                # Utility functions
```

### Routing Architecture

**Role-based nested routing** using React Router:

```typescript
/login                           → Public
/                                → RequireAuth wrapper
  ├── /admin/*                   → RequireRole(['SystemAdmin'])
  │   ├── /dashboard
  │   ├── /users
  │   ├── /invites
  │   ├── /audit-logs
  │   └── /settings
  ├── /hr/*                      → RequireRole(['HRManager', 'SystemAdmin'])
  │   ├── /dashboard
  │   ├── /employees
  │   ├── /payroll
  │   ├── /leave/requests
  │   ├── /announcements
  │   └── /import/employees
  ├── /manager/*                 → RequireRole(['Manager', 'SystemAdmin'])
  │   ├── /dashboard
  │   └── /team-requests
  └── /employee/*                → RequireRole(['Employee', ...all roles])
      ├── /dashboard
      ├── /profile
      ├── /payslips
      └── /leave/request
```

### State Management

**Zustand** store for authentication:
- `user`: Current user object
- `token`: JWT access token
- `refreshToken`: JWT refresh token
- `role`: User role for routing decisions
- Actions: `login()`, `logout()`, `refreshAccessToken()`

### API Service Layer

All API calls centralized in `services/api/`:
- **Axios** instance with interceptors
- Automatic token attachment
- Token refresh on 401
- Error handling
- Type-safe requests/responses

---

## API Design

### Authentication Endpoints

```
POST /auth/login
  Body: { email, password }
  Returns: { access, refresh, user: { email, role } }

POST /auth/logout
  Headers: Authorization: Bearer <token>

POST /auth/change-password
  Body: { current_password, new_password }

POST /auth/token/refresh
  Body: { refresh }
  Returns: { access }
```

### Employee Endpoints (HR)

```
GET /api/employees/?search=&department=&position=&page=1&page_size=25
POST /api/employees/
PUT /api/employees/{id}/
GET /api/employees/{id}/
GET /api/employees/expiries/?days=30

POST /api/employees/import/excel
  Content-Type: multipart/form-data
  Returns: { status, inserted_rows } or { status, errors_file_url }

GET /api/employees/imports/
GET /api/employees/imports/{id}/errors-file
```

### Payroll Endpoints (HR)

```
GET /api/payroll-runs/?year=2026&page=1
POST /api/payroll-runs/
  Body: { year, month }
  Returns: PayrollRun with auto-created items

GET /api/payroll-runs/{id}/
GET /api/payroll-runs/{id}/items/?page=1

POST /api/payroll-runs/{id}/finalize/
  Auto-generates payslips for all employees

GET /api/payroll-runs/{id}/export/?format=csv|xlsx|pdf
```

### Leave Endpoints

**Employee**:
```
POST /api/leaves/requests/
  Body: { leave_type_id, start_date, end_date, reason }
  Creates request with status=SUBMITTED

GET /api/leaves/employee/requests/
GET /api/leaves/employee/balance/?year=2026
```

**Manager**:
```
GET /api/leaves/manager/team-requests/?status=pending_manager
POST /api/leaves/manager/requests/{id}/approve/
  Body: { note }
  Changes status to PENDING_HR

POST /api/leaves/manager/requests/{id}/reject/
  Body: { note }
  Changes status to REJECTED
```

**HR**:
```
GET /api/leaves/requests/?status=pending_hr
POST /api/leaves/requests/{id}/approve/
  Body: { comment }
  Final approval → APPROVED

POST /api/leaves/requests/{id}/reject/
  Body: { comment }
  Final rejection → REJECTED
```

### Admin Endpoints

```
GET /api/admin/summary/
  Returns: { total_users, active_users, recent_audits }

GET /api/users/?search=&role=&status=&page=1
POST /api/users/
  Body: { email, full_name, role, is_active }

PATCH /api/users/{id}/status/
  Body: { is_active: true|false }

PUT /api/users/{id}/role/
  Body: { role: "SystemAdmin"|"HRManager"|"Manager"|"Employee" }

POST /api/users/{id}/reset-password/
  Body: { mode: "temporary_password"|"reset_link" }

GET /api/audit-logs/?user_id=&action=&date_from=&date_to=&page=1
GET /api/audit-logs/export/?format=csv
```

### API Standards

- **Base URL**: `http://localhost:8000/api/`
- **Authentication**: `Authorization: Bearer <access_token>`
- **Pagination**: `?page=1&page_size=25` (default: 25 items/page)
- **Response Format**:
  ```json
  {
    "status": "success",
    "data": { ... }
  }
  ```
  or
  ```json
  {
    "status": "error",
    "message": "Error description",
    "errors": [...]
  }
  ```
- **Throttling**: Rate limits on login, import, payroll operations
- **Filtering**: django-filter on list endpoints

---

## Security Architecture

### Threat Model

The system defends against:
1. **Credential attacks**: Brute force, password spraying
2. **Session attacks**: Token theft, replay attacks
3. **Privilege escalation**: Employees accessing HR/Admin endpoints
4. **Injection**: SQL injection, command injection
5. **File upload attacks**: Malicious Excel files
6. **Data leakage**: PII exposure in logs or APIs
7. **CSRF & XSS**: Cross-site attacks
8. **DoS**: Resource exhaustion

### Security Controls

#### 1. **Authentication & Session Security**
- **Password Storage**: Hashed with Django's PBKDF2 (can upgrade to Argon2/bcrypt)
- **Password Policy**: 
  - Minimum length (default 8, recommended 12+)
  - Common password validation
  - User attribute similarity check
- **Account Lockout**: 5 failed attempts → 15 min lockout
- **JWT Tokens**:
  - Access token: 15 min lifetime
  - Refresh token: 14 days, rotated on use
  - Blacklisted on logout
- **Rate Limiting**:
  - Login: 10/min per IP
  - Import: 5/min
  - Payroll operations: 5/min

#### 2. **Authorization (RBAC)**
- **Server-side enforcement** on every endpoint
- **Custom permissions**:
  - `IsSystemAdmin`
  - `IsHRManager`
  - `IsManagerOf` (for leave approvals)
  - `IsEmployeeSelf` (self-service)
- **Employee scoping**: Employee endpoints use `request.user`, never accept employee_id
- **Golden rule**: Frontend checks are UI-only; backend validates all actions

#### 3. **SQL Injection Prevention**
- Django ORM with parameterized queries
- No raw SQL string concatenation
- Least-privilege DB user

#### 4. **File Upload Security (Excel)**
- **File Validation**:
  - Extension: .xlsx only
  - MIME type + file signature validation
  - Max size: 5-10 MB
  - Max rows: 5,000
  - Exact column names required
- **Parsing Timeouts**: Prevent zip bombs
- **Storage**: Private storage (not publicly accessible)
- **Filename Generation**: Ignore user filename, generate UUID
- **All-or-Nothing Import**: Full rollback on any validation error
- **Audit Logging**: Who uploaded, when, file hash, result

#### 5. **API Hardening**
- **Input Validation**: Schema validation on all request bodies
- **Mass Assignment Protection**: Reject unexpected fields
- **Error Handling**: Generic error messages (no stack traces to clients)
- **Security Headers**:
  - HSTS
  - X-Content-Type-Options: nosniff
  - X-Frame-Options: DENY
  - CSP (if applicable)

#### 6. **Data Protection**
- **HTTPS Only**: TLS in production
- **CORS**: Restricted to specific origins (localhost in dev)
- **Logging Rules**:
  - **Never log**: Passwords, tokens, full passport/ID numbers, salary details
  - **Mask sensitive fields**: `****5678` for IDs
- **Audit Trail**: All privileged actions logged with user, IP, timestamp

#### 7. **Deployment Security**
- Secrets in environment variables (not in repo)
- Separate dev/staging/prod environments
- Database backups (recommended: daily)
- Monitoring for auth failures, import failures, unusual payroll actions

---

## System Diagrams

### 1. Database Schema

![Database Schema](file:///d:/HR-FFI-SYSTEM/Diagrams/DB.png)

**Key relationships**:
- User (1) ← (0..1) EmployeeProfile
- EmployeeProfile (*) → (1) Department, Position, TaskGroup, Sponsor
- LeaveRequest (*) → (1) LeaveType
- LeaveRequest (*) → (1) Employee (submitter)
- LeaveRequest (*) → (0..1) Manager (decision)
- LeaveRequest (*) → (0..1) HR User (final decision)
- PayrollRun (1) → (*) PayrollRunItem
- PayrollRun (1) → (*) Payslip
- Payslip (*) → (1) Employee

### 2. Admin User Flow

![Admin Screen Flow](file:///d:/HR-FFI-SYSTEM/Diagrams/Admin%20screen.png)

**Admin workflow**:
- Login → Admin Dashboard
- User Management: Create, disable/activate, reset password, assign roles
- Invites: Send, resend, revoke
- Audit Logs: View and export
- System Settings: Password policy, session timeout, invite expiry

### 3. HR Manager User Flow

![HR Screen Flow](file:///d:/HR-FFI-SYSTEM/Diagrams/HR%20Screen.png)

**HR workflow**:
- Login → HR Dashboard
- **Payroll**: Create run → Review → Finalize → Generate payslips → Export
- **Leave Management**: Inbox → Review request → Approve/Reject
- **Employee Management**:
  - List → View/Edit employee
  - Create new employee
  - Import from Excel → View history → Download errors
- **Employee Import**: Upload → Validate → Import (all-or-nothing)
- **Reference Data**: Manage departments, positions, task groups, sponsors
- **Announcements**: Create and manage organization-wide announcements

### 4. User Activity Flow

![User Activity](file:///d:/HR-FFI-SYSTEM/Diagrams/User%20activaty.png)

**Multi-role activity flows**:
- **System Admin**: User administration, role assignment, audit logging
- **HR Manager**: Employee lifecycle, payroll, leave approval (final), announcements
- **Manager**: Pre-approve team leave requests, view team dashboard
- **Employee**: Submit leave, view profile, view payslips, view announcements

---

## Recent Work

Based on recent conversation history:

### 1. Dashboard Announcements (February 14-15, 2026)
**Objective**: Display announcements on dashboards for all user roles.

**Implementation**:
- Created reusable `AnnouncementWidget` component
- Integrated widget into Employee, HR, and Admin dashboards
- Modal view for full announcement content
- API: `GET /api/announcements/` with role-based filtering

**Files**:
- Backend: [announcements/views.py](file:///d:/HR-FFI-SYSTEM/Backend/announcements/views.py)
- Frontend: 
  - [announcementApi.ts](file:///d:/HR-FFI-SYSTEM/FrontEnd/src/services/api/announcementApi.ts)
  - [ManagerDashboardPage.tsx](file:///d:/HR-FFI-SYSTEM/FrontEnd/src/pages/manager/ManagerDashboardPage.tsx)

### 2. Payroll Processing (February 14, 2026)
**Objective**: Implement monthly/yearly payroll with automated calculations, payslip generation, and export.

**Implementation**:
- Monthly payroll run creation with auto-generated `PayrollRunItem` for all active employees
- Salary calculation including allowances and deductions
- Finalization: Locks payroll and generates `Payslip` records
- Export: CSV, XLSX, PDF formats with detailed salary breakdown
- Validation: Prevent duplicate runs for same year/month

**Key Features**:
- Rate limiting on finalize/export operations
- Audit logging for all payroll actions
- User feedback via notifications
- Accurate calculation testing

---

## Key Architectural Decisions

### 1. **Email as Username**
- No separate username field
- Email is unique identifier (USERNAME_FIELD)
- Simplifies user management

### 2. **Auto-generated Employee IDs**
- Format: `EMP-00123`
- Generated on save, not exposed to users
- Separate from User ID

### 3. **Separate User and EmployeeProfile**
- User: Authentication and authorization
- EmployeeProfile: HR data (salary, documents, employment details)
- OneToOne relationship (optional: not all users are employees)

### 4. **All-or-Nothing Import**
- Validate entire Excel file before inserting
- Use database transaction: commit all or rollback all
- Prevents partial data corruption
- Generate error file with row-level details

### 5. **Multi-tier Leave Approval**
- Phase 1: Manager pre-approval (SUBMITTED → PENDING_HR or REJECTED)
- Phase 2: HR final approval (PENDING_HR → APPROVED or REJECTED)
- Manager can only approve own direct reports
- HR has final say on all requests

### 6. **Payslip Auto-generation**
- Payslips created only on PayrollRun finalization
- Links to both PayrollRun and Employee
- Immutable once created (payroll is locked)

### 7. **Private File Storage**
- Sensitive files (Excel imports, error reports) not publicly accessible
- Custom storage backend: `PrivateUploadStorage`
- Downloaded via authenticated endpoints only

### 8. **Role-based Frontend Routing**
- Nested routes with role guards
- SystemAdmin can access all routes
- HRManager can access HR + Employee routes
- Manager can access Manager + Employee routes
- Employee can access only Employee routes

---

## Next Steps / Roadmap

Based on system architecture:

1. **Attendance Enhancements**
   - GPS-based check-in/check-out
   - Overtime calculation
   - Shift management

2. **Leave Enhancements**
   - Leave calendar view
   - Team leave visualization for managers
   - Automated balance carry-over at year-end

3. **Reporting & Analytics**
   - Employee turnover reports
   - Payroll cost analysis
   - Leave utilization reports

4. **Mobile App**
   - React Native mobile app for employee self-service
   - Push notifications for leave approvals

5. **Multi-Factor Authentication (MFA)**
   - TOTP-based MFA for SystemAdmin and HRManager roles
   - SMS OTP fallback

6. **Document Management**
   - Upload passport/ID scans
   - Automated expiry email notifications
   - Document versioning

7. **Performance Management**
   - Employee reviews and ratings
   - Goal tracking
   - 360-degree feedback

---

## Development Setup

### Backend
```bash
cd Backend
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

### Frontend
```bash
cd FrontEnd
npm install
npm run dev
```

### Environment Variables
```
# Backend (.env)
DJANGO_SECRET_KEY=...
DATABASE_URL=postgresql://user:pass@localhost:5432/ffi_hr_db
RESEND_API_KEY=...
FRONTEND_URL=http://localhost:5173

# Frontend (.env)
VITE_API_BASE_URL=http://localhost:8000/api
```

---

## Contact & Support

For questions or support, contact the development team.

**System Status**: ✅ Production Ready (with recent enhancements to announcements and payroll)
