const express = require('express');
const router = express.Router();
const { connectMongo, getUsersCollection } = require('../../../config/mongo');
const { requireCompany } = require('../utils/hrmsContext');
const { SalaryCalculationService } = require('../services/payroll/SalaryCalculationService');
const {
  loadPayrollCompanySettings,
  savePayrollCompanySettings,
} = require('../services/payroll/payrollSettingsStore');
const {
  loadPayrollAttendanceAdjustment,
  savePayrollAttendanceAdjustment,
} = require('../services/payroll/payrollAttendanceAdjustmentStore');

/**
 * Payroll APIs (mounted at /api/hrms).
 *
 * Wizard-style:
 * - Step 1: Sync Attendance (here: compute LOP snapshot)
 * - Step 2: Preview Adjustments (returns computed preview)
 * - Step 3: Finalize (maker) + Approve (checker)
 */

function parseMonthYear(v) {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  return s;
}

router.get('/payroll/settings', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const data = await loadPayrollCompanySettings(company);
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[payroll/settings GET] error', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.put('/payroll/settings', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const data = await savePayrollCompanySettings(company, req.body || {});
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[payroll/settings PUT] error', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Preview payroll for one employee (calculation engine)
router.get('/payroll/preview', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();

    const employeeId = String(req.query.employeeId || '').trim();
    const monthYear = parseMonthYear(req.query.monthYear);
    if (!employeeId || !monthYear) {
      return res.status(400).json({ success: false, error: 'employeeId and monthYear (YYYY-MM) are required.' });
    }

    const svc = new SalaryCalculationService();
    const profile = await svc.loadPayrollProfile({ company, employeeId });

    const annualCtc = Number(req.query.annualCtc || profile.annualCtc || 0);
    if (!Number.isFinite(annualCtc) || annualCtc <= 0) {
      return res.status(400).json({ success: false, error: 'annualCtc is required (or store annualCtc on employee).' });
    }

    const structureRules = {
      basicPercentOfCtc: req.query.basicPercentOfCtc != null ? Number(req.query.basicPercentOfCtc) : 50,
      hraPercentOfBasic: req.query.hraPercentOfBasic != null ? Number(req.query.hraPercentOfBasic) : 40,
      fixedEarnings: [],
    };

    const result = await svc.calculateEmployeePayroll({
      company,
      employeeId,
      monthYear,
      annualCtc,
      structureRules,
      payrollProfile: profile,
    });

    return res.json({ success: true, data: result });
  } catch (e) {
    console.error('[payroll/preview] error', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * All employees × one month: attendance from machine_attendance_reports + salary (LOP proration).
 */
router.get('/payroll/employees-month-overview', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();

    const monthYear = parseMonthYear(req.query.monthYear);
    if (!monthYear) {
      return res.status(400).json({ success: false, error: 'monthYear (YYYY-MM) is required.' });
    }

    const usersCol = await getUsersCollection(null, company);
    const users = await usersCol
      .find({ company, isActive: { $ne: false } })
      .project({
        name: 1,
        email: 1,
        employeeId: 1,
        department: 1,
        jobTitle: 1,
        annualCtc: 1,
        emp_code: 1,
        pfRule: 1,
        pfSlabId: 1,
        joiningDate: 1,
        bankAccount: 1,
        uan: 1,
        pfNo: 1,
        pan: 1,
      })
      .toArray();

    const svc = new SalaryCalculationService();
    const structureRules = {
      basicPercentOfCtc:
        req.query.basicPercentOfCtc != null ? Number(req.query.basicPercentOfCtc) : 50,
      hraPercentOfBasic:
        req.query.hraPercentOfBasic != null ? Number(req.query.hraPercentOfBasic) : 40,
      fixedEarnings: [],
    };

    const rows = [];
    for (const emp of users) {
      const employeeId = String(emp.employeeId || '').trim();
      if (!employeeId) {
        rows.push({
          mongoId: emp._id?.toString(),
          employeeId: null,
          name: emp.name || '',
          email: emp.email || '',
          ok: false,
          error: 'MISSING_EMPLOYEE_ID',
        });
        continue;
      }

      const annualCtc = Number(emp.annualCtc);
      if (!Number.isFinite(annualCtc) || annualCtc <= 0) {
        rows.push({
          mongoId: emp._id?.toString(),
          employeeId,
          name: emp.name || '',
          email: emp.email || '',
          department: emp.department || '',
          jobTitle: emp.jobTitle || '',
          annualCtc: null,
          ok: false,
          error: 'NO_CTC',
        });
        continue;
      }

      try {
        const profile = await svc.loadPayrollProfile({ company, employeeId });
        const payrollProfile = {
          ...profile,
          emp_code: emp.emp_code ?? profile.emp_code,
          pfRule: emp.pfRule ?? profile.pfRule,
          pfSlabId: emp.pfSlabId ?? profile.pfSlabId,
          annualCtc,
        };

        const result = await svc.calculateEmployeePayroll({
          company,
          employeeId,
          monthYear,
          annualCtc,
          structureRules,
          payrollProfile,
        });

        const pf = result.statutory?.pf || {};
        rows.push({
          mongoId: emp._id?.toString(),
          employeeId,
          name: emp.name || '',
          email: emp.email || '',
          department: emp.department || '',
          jobTitle: emp.jobTitle || '',
          annualCtc,
          joiningDate: emp.joiningDate || null,
          bankAccount: emp.bankAccount || '',
          uan: emp.uan || '',
          pfNo: emp.pfNo || '',
          pan: emp.pan || '',
          ok: true,
          paidDays: result.attendance?.paidDays ?? null,
          paidDaysFromMachine: result.attendance?.paidDaysFromMachine ?? null,
          paidDaysAdjustment: result.attendance?.paidDaysAdjustment ?? 0,
          lopDays: result.attendance?.lopDays ?? null,
          workingDaysInMonth: result.attendance?.workingDaysInMonth ?? null,
          daysInMonth: result.attendance?.daysInMonth ?? null,
          grossMonthly: result.totals?.gross ?? 0,
          netMonthly: result.totals?.netPay ?? 0,
          pfEmployee: pf.employee ?? 0,
          pfEmployer: pf.employer ?? 0,
          pfSlab: result.pfSlab || null,
        });
      } catch (err) {
        rows.push({
          mongoId: emp._id?.toString(),
          employeeId,
          name: emp.name || '',
          ok: false,
          error: err?.message || 'CALC_ERROR',
        });
      }
    }

    return res.json({ success: true, data: { monthYear, company, employees: rows } });
  } catch (e) {
    console.error('[payroll/employees-month-overview] error', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * GET/PUT saved manual paid-day delta for a month (forgot punch / HR correction).
 */
router.get('/payroll/attendance-adjustment', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const employeeId = String(req.query.employeeId || '').trim();
    const monthYear = parseMonthYear(req.query.monthYear);
    if (!employeeId || !monthYear) {
      return res.status(400).json({ success: false, error: 'employeeId and monthYear (YYYY-MM) are required.' });
    }
    const data = await loadPayrollAttendanceAdjustment(company, employeeId, monthYear);
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[payroll/attendance-adjustment GET] error', e);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

router.put('/payroll/attendance-adjustment', async (req, res) => {
  try {
    const company = requireCompany(req, res);
    if (!company) return;
    await connectMongo();
    const employeeId = String(req.body?.employeeId || req.query.employeeId || '').trim();
    const monthYear = parseMonthYear(req.body?.monthYear || req.query.monthYear);
    if (!employeeId || !monthYear) {
      return res.status(400).json({ success: false, error: 'employeeId and monthYear (YYYY-MM) are required.' });
    }
    const data = await savePayrollAttendanceAdjustment(company, employeeId, monthYear, req.body?.deltaPaidDays);
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[payroll/attendance-adjustment PUT] error', e);
    return res
      .status(400)
      .json({ success: false, error: e?.message || 'Invalid request' });
  }
});

module.exports = router;

