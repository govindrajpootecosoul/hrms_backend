// Mock data for HRMS Portal

export type UserRole = 'admin' | 'hr' | 'manager' | 'employee';

export interface User {
  id: string;
  email: string;
  password: string;
  name: string;
  role: UserRole;
  employeeId?: string;
}

export interface Employee {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  phone: string;
  dob: string;
  gender: 'Male' | 'Female' | 'Other';
  pan: string;
  aadhaar: string; // Hashed in real app
  department: string;
  designation: string;
  reportingManager: string;
  joiningDate: string;
  probationEndDate?: string;
  status: 'Active' | 'Inactive' | 'On Leave' | 'Resigned';
  pfUan?: string;
  esiNo?: string;
  bankAccount: string;
  ifsc: string;
  taxRegime: 'Old' | 'New';
  salaryStructure?: SalaryStructure;
  documents?: Document[];
}

export interface SalaryStructure {
  id: string;
  name: string;
  payheads: Payhead[];
}

export interface Payhead {
  code: string;
  name: string;
  type: 'Earning' | 'Deduction';
  calculation: 'Fixed' | 'Percentage';
  value: number;
  taxable: boolean;
}

export interface Attendance {
  id: string;
  employeeId: string;
  date: string;
  inTime: string;
  outTime?: string;
  duration?: number;
  status: 'Present' | 'Absent' | 'Half Day' | 'Late' | 'On Leave';
  leaveType?: string;
}

export interface Leave {
  id: string;
  employeeId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  appliedDate: string;
  approvedBy?: string;
  approvedDate?: string;
}

export interface LeaveBalance {
  employeeId: string;
  leaveType: string;
  total: number;
  used: number;
  balance: number;
}


export interface Department {
  id: string;
  name: string;
  head: string;
  employeeCount: number;
}

export interface Job {
  id: string;
  title: string;
  department: string;
  experience: string;
  location: string;
  status: 'Open' | 'Closed' | 'On Hold';
  postedDate: string;
}

export interface Candidate {
  id: string;
  name: string;
  email: string;
  phone: string;
  appliedPosition: string;
  stage: 'Applied' | 'Screening' | 'Interview' | 'Offer' | 'Joined' | 'Rejected';
  assignedRecruiter: string;
  resumeUrl?: string;
  interviewDate?: string;
  offerDate?: string;
  joiningDate?: string;
}

export interface Document {
  id: string;
  name: string;
  type: string;
  url: string;
  uploadedDate: string;
}

export interface Holiday {
  id: string;
  name: string;
  date: string;
  location: string;
  type: 'National' | 'Regional' | 'Company';
}

export interface ExpenseRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  category: string;
  amount: number;
  date: string;
  paymentMode: 'Cash' | 'Card' | 'UPI' | 'Bank Transfer';
  projectCode?: string;
  receiptUrl?: string;
  description?: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Paid';
}

export interface AdvanceSettlement {
  actualExpense: number;
  balance: number;
  balanceType: 'Refund' | 'Recover' | 'Balanced';
  lineItems?: ExpenseRecord[];
}

export interface AdvanceRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  requestedAmount: number;
  purpose: string;
  requestedOn: string;
  expectedStartDate?: string;
  expectedEndDate?: string;
  mode: 'Bank Transfer' | 'Cash';
  status: 'Requested' | 'Approved' | 'Released' | 'Settled' | 'Closed';
  releasedAmount?: number;
  settlement?: AdvanceSettlement;
  itineraryUrl?: string;
}

export interface ClaimRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  type: 'Non-Advance' | 'Advance Settlement';
  category: string;
  totalExpense: number;
  againstAdvance?: string;
  pendingAmount?: number;
  status: string;
  submittedOn: string;
  lineItems?: ExpenseRecord[];
  receipts?: string[];
  approvalTimeline?: Array<{ stage: string; owner: string; status: string; date: string; remarks?: string }>;
  auditTrail?: Array<{ action: string; by: string; date: string }>;
  comments?: Array<{ from: string; message: string; date: string }>;
}

export interface ApprovalItem {
  id: string;
  employeeName: string;
  claimId: string;
  amount: number;
  stage: 'Manager' | 'HR' | 'Finance';
  submittedOn: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  policyFlags?: string[];
}

export interface ExpensePolicies {
  categories: Array<{
    id: string;
    name: string;
    limitPerDay: number;
    limitPerMonth: number;
    requiresReceipt: boolean;
    paymentModes: string[];
  }>;
  paymentModes: string[];
  travelPolicy: {
    mileageRate: number;
    lodgingCap: number;
    mealCap: number;
    internationalAllowance: number;
  };
  autoFlagRules: Array<{ id: string; name: string; condition: string; action: string }>;
}

export interface ExpenseOverview {
  kpis: {
    totalClaims: number;
    pendingApprovals: number;
    approvedClaims: number;
    rejectedClaims: number;
    outstandingAdvances: number;
    settledAmount: number;
    avgReimbursementTime: number;
  };
  categoryBreakdown: Array<{ name: string; value: number }>;
  monthlyTrends: Array<{ month: string; raised: number; settled: number }>;
  departmentSpend: Array<{ department: string; amount: number }>;
  advanceComparison: Array<{ month: string; advance: number; actual: number }>;
  recentClaims: Array<{
    id: string;
    employee: string;
    type: string;
    amount: number;
    date: string;
    status: string;
  }>;
}

export interface ExpenseReportsSummary {
  generated: number;
  pending: number;
  avgTurnaround: number;
  violationCount: number;
  types: Array<{ id: string; name: string; description: string }>;
}

// Mock Users
export const mockUsers: User[] = [
  { id: '1', email: 'admin@vectorlytics.com', password: 'admin123', name: 'Admin User', role: 'admin' },
  { id: '2', email: 'hr@vectorlytics.com', password: 'hr123', name: 'HR Manager', role: 'hr', employeeId: 'EMP001' },
  { id: '3', email: 'manager@vectorlytics.com', password: 'manager123', name: 'Department Manager', role: 'manager', employeeId: 'EMP002' },
  { id: '4', email: 'employee@vectorlytics.com', password: 'employee123', name: 'John Doe', role: 'employee', employeeId: 'EMP003' },
];

// Mock Employees
export const mockEmployees: Employee[] = [
  {
    id: '1',
    employeeId: 'EMP001',
    name: 'HR Manager',
    email: 'hr@vectorlytics.com',
    phone: '+91 9876543210',
    dob: '1990-05-15',
    gender: 'Female',
    pan: 'ABCDE1234F',
    aadhaar: '1234-5678-9012',
    department: 'Human Resources',
    designation: 'HR Manager',
    reportingManager: 'CEO',
    joiningDate: '2020-01-15',
    status: 'Active',
    pfUan: '123456789012',
    esiNo: '1234567890',
    bankAccount: '12345678901234',
    ifsc: 'HDFC0001234',
    taxRegime: 'New',
  },
  {
    id: '2',
    employeeId: 'EMP002',
    name: 'Department Manager',
    email: 'manager@vectorlytics.com',
    phone: '+91 9876543211',
    dob: '1988-03-20',
    gender: 'Male',
    pan: 'FGHIJ5678K',
    aadhaar: '2345-6789-0123',
    department: 'Engineering',
    designation: 'Engineering Manager',
    reportingManager: 'CTO',
    joiningDate: '2019-06-01',
    status: 'Active',
    pfUan: '234567890123',
    esiNo: '2345678901',
    bankAccount: '23456789012345',
    ifsc: 'ICIC0002345',
    taxRegime: 'Old',
  },
  {
    id: '3',
    employeeId: 'EMP003',
    name: 'John Doe',
    email: 'employee@vectorlytics.com',
    phone: '+91 9876543212',
    dob: '1995-08-10',
    gender: 'Male',
    pan: 'KLMNO9012P',
    aadhaar: '3456-7890-1234',
    department: 'Engineering',
    designation: 'Software Engineer',
    reportingManager: 'EMP002',
    joiningDate: '2022-03-01',
    status: 'Active',
    pfUan: '345678901234',
    esiNo: '3456789012',
    bankAccount: '34567890123456',
    ifsc: 'SBIN0003456',
    taxRegime: 'New',
  },
  {
    id: '4',
    employeeId: 'EMP004',
    name: 'Jane Smith',
    email: 'jane.smith@vectorlytics.com',
    phone: '+91 9876543213',
    dob: '1992-11-25',
    gender: 'Female',
    pan: 'PQRST3456U',
    aadhaar: '4567-8901-2345',
    department: 'Sales',
    designation: 'Sales Executive',
    reportingManager: 'EMP005',
    joiningDate: '2021-07-15',
    status: 'Active',
    pfUan: '456789012345',
    esiNo: '4567890123',
    bankAccount: '45678901234567',
    ifsc: 'AXIS0004567',
    taxRegime: 'New',
  },
  {
    id: '5',
    employeeId: 'EMP005',
    name: 'Sales Manager',
    email: 'sales.manager@vectorlytics.com',
    phone: '+91 9876543214',
    dob: '1985-02-14',
    gender: 'Male',
    pan: 'UVWXY6789V',
    aadhaar: '5678-9012-3456',
    department: 'Sales',
    designation: 'Sales Manager',
    reportingManager: 'CEO',
    joiningDate: '2018-04-01',
    status: 'Active',
    pfUan: '567890123456',
    esiNo: '5678901234',
    bankAccount: '56789012345678',
    ifsc: 'HDFC0005678',
    taxRegime: 'Old',
  },
];

// Mock Departments
export const mockDepartments: Department[] = [
  { id: '1', name: 'Engineering', head: 'CTO', employeeCount: 15 },
  { id: '2', name: 'Sales', head: 'EMP005', employeeCount: 8 },
  { id: '3', name: 'Human Resources', head: 'EMP001', employeeCount: 5 },
  { id: '4', name: 'Finance', head: 'CFO', employeeCount: 6 },
  { id: '5', name: 'Marketing', head: 'CMO', employeeCount: 4 },
];

// Mock Attendance
export const mockAttendance: Attendance[] = [
  { id: '1', employeeId: 'EMP003', date: '2024-01-15', inTime: '09:00', outTime: '18:00', duration: 9, status: 'Present' },
  { id: '2', employeeId: 'EMP004', date: '2024-01-15', inTime: '09:15', outTime: '18:30', duration: 9.25, status: 'Late' },
  { id: '3', employeeId: 'EMP001', date: '2024-01-15', inTime: '09:00', outTime: '13:00', duration: 4, status: 'Half Day' },
];

// Mock Leaves
export const mockLeaves: Leave[] = [
  {
    id: '1',
    employeeId: 'EMP003',
    leaveType: 'PL',
    startDate: '2024-01-20',
    endDate: '2024-01-22',
    days: 3,
    reason: 'Personal work',
    status: 'Pending',
    appliedDate: '2024-01-10',
  },
  {
    id: '2',
    employeeId: 'EMP004',
    leaveType: 'CL',
    startDate: '2024-01-18',
    endDate: '2024-01-18',
    days: 1,
    reason: 'Sick',
    status: 'Approved',
    appliedDate: '2024-01-15',
    approvedBy: 'EMP005',
    approvedDate: '2024-01-16',
  },
];

// Mock Holidays
export const mockHolidays: Holiday[] = [
  { id: '1', name: 'Republic Day', date: '2024-01-26', location: 'All', type: 'National' },
  { id: '2', name: 'Holi', date: '2024-03-25', location: 'All', type: 'National' },
  { id: '3', name: 'Independence Day', date: '2024-08-15', location: 'All', type: 'National' },
];

// Mock Jobs
export const mockJobs: Job[] = [
  { id: '1', title: 'Senior Software Engineer', department: 'Engineering', experience: '5-8 years', location: 'Bangalore', status: 'Open', postedDate: '2024-01-01' },
  { id: '2', title: 'Sales Executive', department: 'Sales', experience: '2-4 years', location: 'Mumbai', status: 'Open', postedDate: '2024-01-05' },
];

// Mock Candidates
export const mockCandidates: Candidate[] = [
  { id: '1', name: 'Candidate One', email: 'candidate1@example.com', phone: '+91 9876543299', appliedPosition: '1', stage: 'Interview', assignedRecruiter: 'EMP001', interviewDate: '2024-01-20' },
  { id: '2', name: 'Candidate Two', email: 'candidate2@example.com', phone: '+91 9876543298', appliedPosition: '2', stage: 'Offer', assignedRecruiter: 'EMP001', offerDate: '2024-01-18' },
];

export let mockExpenses: ExpenseRecord[] = [
  {
    id: 'EXP001',
    employeeId: 'EMP003',
    employeeName: 'John Doe',
    category: 'Travel',
    amount: 1200,
    date: '2025-01-12',
    paymentMode: 'UPI',
    projectCode: 'PR-391',
    description: 'Client visit travel',
    receiptUrl: '/receipts/exp001.pdf',
    status: 'Pending',
  },
  {
    id: 'EXP002',
    employeeId: 'EMP004',
    employeeName: 'Jane Smith',
    category: 'Meals',
    amount: 450,
    date: '2025-01-10',
    paymentMode: 'Card',
    description: 'Team dinner with client',
    status: 'Approved',
  },
  {
    id: 'EXP003',
    employeeId: 'EMP002',
    employeeName: 'Department Manager',
    category: 'Office Supplies',
    amount: 780,
    date: '2025-01-08',
    paymentMode: 'Cash',
    description: 'Printer cartridges',
    status: 'Paid',
  },
  {
    id: 'EXP004',
    employeeId: 'EMP005',
    employeeName: 'Sales Manager',
    category: 'Client Visit',
    amount: 2150,
    date: '2025-01-05',
    paymentMode: 'Bank Transfer',
    projectCode: 'CL-552',
    description: 'Client entertainment',
    status: 'Rejected',
  },
];

export let mockAdvances: AdvanceRequest[] = [
  {
    id: 'ADV001',
    employeeId: 'EMP004',
    employeeName: 'Jane Smith',
    requestedAmount: 5000,
    purpose: 'Outstation Travel - Mumbai',
    requestedOn: '2025-01-02',
    expectedStartDate: '2025-01-15',
    expectedEndDate: '2025-01-18',
    mode: 'Bank Transfer',
    status: 'Released',
    releasedAmount: 5000,
    settlement: {
      actualExpense: 4600,
      balance: 400,
      balanceType: 'Refund',
    },
  },
  {
    id: 'ADV002',
    employeeId: 'EMP003',
    employeeName: 'John Doe',
    requestedAmount: 3200,
    purpose: 'Conference Attendance',
    requestedOn: '2025-01-05',
    expectedStartDate: '2025-01-20',
    expectedEndDate: '2025-01-22',
    mode: 'Bank Transfer',
    status: 'Approved',
  },
  {
    id: 'ADV003',
    employeeId: 'EMP006',
    employeeName: 'Emily Chen',
    requestedAmount: 1500,
    purpose: 'Local client visits',
    requestedOn: '2025-01-09',
    mode: 'Cash',
    status: 'Requested',
  },
];

export let mockClaims: ClaimRecord[] = [
  {
    id: 'CLM009',
    employeeId: 'EMP004',
    employeeName: 'Jane Smith',
    type: 'Advance Settlement',
    category: 'Travel',
    totalExpense: 4600,
    againstAdvance: 'ADV001',
    pendingAmount: 400,
    status: 'Pending HR Approval',
    submittedOn: '2025-01-19',
    lineItems: [
      { id: 'LINE1', employeeId: 'EMP004', employeeName: 'Jane Smith', category: 'Flight', amount: 2800, date: '2025-01-16', paymentMode: 'Card', status: 'Pending' },
      { id: 'LINE2', employeeId: 'EMP004', employeeName: 'Jane Smith', category: 'Hotel', amount: 1400, date: '2025-01-17', paymentMode: 'Card', status: 'Pending' },
      { id: 'LINE3', employeeId: 'EMP004', employeeName: 'Jane Smith', category: 'Meals', amount: 400, date: '2025-01-17', paymentMode: 'Cash', status: 'Pending' },
    ],
    receipts: ['/receipts/adv001-hotel.pdf', '/receipts/adv001-flight.pdf'],
    approvalTimeline: [
      { stage: 'Manager', owner: 'EMP005', status: 'Approved', date: '2025-01-20' },
      { stage: 'HR', owner: 'EMP001', status: 'Pending', date: '2025-01-21' },
    ],
    auditTrail: [
      { action: 'Claim Submitted', by: 'Jane Smith', date: '2025-01-19' },
      { action: 'Manager Approved', by: 'Sales Manager', date: '2025-01-20' },
    ],
    comments: [
      { from: 'Manager', message: 'Looks good. Please settle ASAP.', date: '2025-01-20' },
    ],
  },
  {
    id: 'CLM010',
    employeeId: 'EMP003',
    employeeName: 'John Doe',
    type: 'Non-Advance',
    category: 'Internet',
    totalExpense: 1200,
    pendingAmount: 0,
    status: 'Pending Finance Approval',
    submittedOn: '2025-01-12',
  },
];

export let mockApprovals: { manager: ApprovalItem[]; hr: ApprovalItem[]; finance: ApprovalItem[] } = {
  manager: [
    { id: 'APM001', employeeName: 'Emily Chen', claimId: 'CLM011', amount: 980, stage: 'Manager', submittedOn: '2025-01-18', status: 'Pending', policyFlags: ['Over meal limit by ₹80'] },
  ],
  hr: [
    { id: 'APH001', employeeName: 'Jane Smith', claimId: 'CLM009', amount: 4600, stage: 'HR', submittedOn: '2025-01-19', status: 'Pending' },
  ],
  finance: [
    { id: 'APF001', employeeName: 'John Doe', claimId: 'CLM010', amount: 1200, stage: 'Finance', submittedOn: '2025-01-12', status: 'Pending' },
  ],
};

export let expensePolicies: ExpensePolicies = {
  categories: [
    { id: 'CAT001', name: 'Travel', limitPerDay: 3000, limitPerMonth: 20000, requiresReceipt: true, paymentModes: ['Card', 'UPI', 'Bank Transfer'] },
    { id: 'CAT002', name: 'Meals', limitPerDay: 1200, limitPerMonth: 8000, requiresReceipt: true, paymentModes: ['Card', 'Cash', 'UPI'] },
    { id: 'CAT003', name: 'Office Supplies', limitPerDay: 5000, limitPerMonth: 15000, requiresReceipt: true, paymentModes: ['Card', 'Bank Transfer'] },
    { id: 'CAT004', name: 'Client Entertainment', limitPerDay: 6000, limitPerMonth: 25000, requiresReceipt: true, paymentModes: ['Card', 'Bank Transfer'] },
  ],
  paymentModes: ['Cash', 'Card', 'UPI', 'Bank Transfer'],
  travelPolicy: {
    mileageRate: 12,
    lodgingCap: 4500,
    mealCap: 1200,
    internationalAllowance: 80,
  },
  autoFlagRules: [
    { id: 'RULE001', name: 'Exceeds Category Limit', condition: 'Amount > category.limitPerDay', action: 'Flag for HR review' },
    { id: 'RULE002', name: 'Receipt Missing', condition: 'Receipt not uploaded', action: 'Flag for employee follow-up' },
    { id: 'RULE003', name: 'Duplicate Expense', condition: 'Same amount + date + category', action: 'Flag for finance audit' },
  ],
};

export const expenseOverviewData: ExpenseOverview = {
  kpis: {
    totalClaims: 128,
    pendingApprovals: 18,
    approvedClaims: 92,
    rejectedClaims: 6,
    outstandingAdvances: 18500,
    settledAmount: 74200,
    avgReimbursementTime: 4.2,
  },
  categoryBreakdown: [
    { name: 'Travel', value: 42000 },
    { name: 'Meals', value: 15800 },
    { name: 'Client Visit', value: 28600 },
    { name: 'Office Supplies', value: 11200 },
    { name: 'Others', value: 5400 },
  ],
  monthlyTrends: [
    { month: 'Aug', raised: 42, settled: 35 },
    { month: 'Sep', raised: 48, settled: 44 },
    { month: 'Oct', raised: 52, settled: 50 },
    { month: 'Nov', raised: 60, settled: 55 },
    { month: 'Dec', raised: 58, settled: 57 },
    { month: 'Jan', raised: 63, settled: 49 },
  ],
  departmentSpend: [
    { department: 'Sales', amount: 38000 },
    { department: 'Engineering', amount: 24500 },
    { department: 'Marketing', amount: 19800 },
    { department: 'HR', amount: 8600 },
    { department: 'Operations', amount: 21400 },
  ],
  advanceComparison: [
    { month: 'Sep', advance: 20000, actual: 18800 },
    { month: 'Oct', advance: 24500, actual: 23800 },
    { month: 'Nov', advance: 28000, actual: 27500 },
    { month: 'Dec', advance: 31000, actual: 30100 },
    { month: 'Jan', advance: 33500, actual: 31900 },
  ],
  recentClaims: [
    { id: 'CLM010', employee: 'John Doe', type: 'Non-Advance', amount: 1200, date: '2025-01-12', status: 'Pending Finance' },
    { id: 'CLM009', employee: 'Jane Smith', type: 'Advance Settlement', amount: 4600, date: '2025-01-19', status: 'Pending HR' },
    { id: 'CLM008', employee: 'Emily Chen', type: 'Non-Advance', amount: 980, date: '2025-01-18', status: 'Pending Manager' },
    { id: 'CLM007', employee: 'Robert Taylor', type: 'Non-Advance', amount: 1500, date: '2025-01-16', status: 'Approved' },
    { id: 'CLM006', employee: 'Mike Davis', type: 'Non-Advance', amount: 890, date: '2025-01-14', status: 'Rejected' },
  ],
};

export const expenseReportsSummary: ExpenseReportsSummary = {
  generated: 68,
  pending: 7,
  avgTurnaround: 3.4,
  violationCount: 5,
  types: [
    { id: 'expense-category', name: 'Category-wise Expense Report', description: 'Breakdown of expenses by categories' },
    { id: 'expense-employee', name: 'Employee-wise Expense Report', description: 'Expenses raised per employee' },
    { id: 'expense-department', name: 'Department-wise Monthly Spend', description: 'Department spend trends' },
    { id: 'advance-outstanding', name: 'Advance Outstanding Report', description: 'Track pending advances' },
    { id: 'turnaround-time', name: 'Reimbursement Turnaround Time', description: 'Cycle time analysis' },
    { id: 'policy-violation', name: 'Policy Violation Report', description: 'Flagged expenses summary' },
  ],
};

// Export all mock data
export default {
  users: mockUsers,
  employees: mockEmployees,
  departments: mockDepartments,
  attendance: mockAttendance,
  leaves: mockLeaves,
  holidays: mockHolidays,
  jobs: mockJobs,
  candidates: mockCandidates,
  expenses: mockExpenses,
  advances: mockAdvances,
  claims: mockClaims,
  approvals: mockApprovals,
  expensePolicies,
  expenseOverviewData,
  expenseReportsSummary,
};

