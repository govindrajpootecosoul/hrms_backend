import express from 'express';
import {
  mockExpenses,
  mockAdvances,
  mockClaims,
  mockApprovals,
  expensePolicies,
  expenseOverviewData,
  expenseReportsSummary,
} from '../data/mockData';

const router = express.Router();

// Helper to generate IDs
const generateId = (prefix: string, length = 3) => {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}${String(rand).slice(-length)}`;
};

// Overview dashboard
router.get('/overview', (req, res) => {
  res.json(expenseOverviewData);
});

// Expenses (non-advance)
router.get('/', (req, res) => {
  res.json(mockExpenses);
});

router.post('/add', (req, res) => {
  const newExpense = { id: generateId('EXP', 4), status: 'Pending', ...req.body };
  mockExpenses.unshift(newExpense);
  res.json(newExpense);
});

router.put('/:id', (req, res) => {
  const index = mockExpenses.findIndex((exp) => exp.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: 'Expense not found' });
  }
  mockExpenses[index] = { ...mockExpenses[index], ...req.body };
  res.json(mockExpenses[index]);
});

router.delete('/:id', (req, res) => {
  const index = mockExpenses.findIndex((exp) => exp.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: 'Expense not found' });
  }
  const [deleted] = mockExpenses.splice(index, 1);
  res.json(deleted);
});

// Advances
router.get('/advances', (req, res) => {
  res.json(mockAdvances);
});

router.post('/advances/add', (req, res) => {
  const newAdvance = {
    id: generateId('ADV', 3),
    status: 'Requested',
    requestedOn: new Date().toISOString().split('T')[0],
    ...req.body,
  };
  mockAdvances.unshift(newAdvance);
  res.json(newAdvance);
});

router.put('/advances/:id', (req, res) => {
  const index = mockAdvances.findIndex((adv) => adv.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: 'Advance not found' });
  }
  mockAdvances[index] = { ...mockAdvances[index], ...req.body };
  res.json(mockAdvances[index]);
});

router.post('/advances/settle', (req, res) => {
  const { advanceId, settlement } = req.body;
  const advance = mockAdvances.find((adv) => adv.id === advanceId);
  if (!advance) {
    return res.status(404).json({ message: 'Advance not found' });
  }
  advance.status = 'Settled';
  advance.settlement = settlement;
  res.json(advance);
});

// Claims
router.get('/claims', (req, res) => {
  res.json(mockClaims);
});

router.post('/claims/add', (req, res) => {
  const newClaim = {
    id: generateId('CLM', 3),
    status: 'Pending Manager Approval',
    submittedOn: new Date().toISOString().split('T')[0],
    ...req.body,
  };
  mockClaims.unshift(newClaim);
  res.json(newClaim);
});

router.put('/claims/:id/status', (req, res) => {
  const claim = mockClaims.find((clm) => clm.id === req.params.id);
  if (!claim) {
    return res.status(404).json({ message: 'Claim not found' });
  }
  claim.status = req.body.status || claim.status;
  res.json(claim);
});

// Approvals
router.get('/approvals', (req, res) => {
  res.json(mockApprovals);
});

router.post('/approvals/action', (req, res) => {
  const { id, stage, action, comments } = req.body;
  const bucket = stage.toLowerCase() as 'manager' | 'hr' | 'finance';
  const item = mockApprovals[bucket]?.find((appr) => appr.id === id);
  if (!item) {
    return res.status(404).json({ message: 'Approval item not found' });
  }
  item.status = action;
  if (comments) {
    item.policyFlags = [...(item.policyFlags || []), `Note: ${comments}`];
  }
  res.json(item);
});

// Policies
router.get('/policies', (req, res) => {
  res.json(expensePolicies);
});

router.put('/policies/update', (req, res) => {
  Object.assign(expensePolicies, req.body);
  res.json(expensePolicies);
});

// Reports
router.get('/reports/summary', (req, res) => {
  res.json(expenseReportsSummary);
});

router.get('/reports/export', (req, res) => {
  res.json({ message: 'Report generation initiated (simulated)' });
});

export default router;


