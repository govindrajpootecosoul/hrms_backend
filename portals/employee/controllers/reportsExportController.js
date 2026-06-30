const { getCompanyFromRequest } = require('../utils/employeeContext');
const {
  buildAttendanceExportRows,
  buildRequestsExportRows,
  attendanceToCsv,
  requestsToCsv,
  attendanceToPdf,
} = require('../services/reportsExportService');

function firstQueryValue(val) {
  if (val == null || val === '') return null;
  const v = Array.isArray(val) ? val[0] : val;
  const s = String(v).trim();
  return s || null;
}

async function exportAttendanceReport(req, res) {
  try {
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });

    const employeeId = firstQueryValue(req.query.employeeId);
    const empCode = firstQueryValue(req.query.empCode);
    const format = (firstQueryValue(req.query.format) || 'csv').toLowerCase();

    if (!employeeId) {
      return res.status(400).json({ success: false, error: 'employeeId is required' });
    }
    if (!['csv', 'pdf'].includes(format)) {
      return res.status(400).json({ success: false, error: 'format must be csv or pdf' });
    }

    const data = await buildAttendanceExportRows({ employeeId, company, empCode });
    const stamp = data.range.endDate;

    if (format === 'pdf') {
      const pdfBuffer = await attendanceToPdf(data);
      const filename = `attendance_${employeeId}_${stamp}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(pdfBuffer);
    }

    const csv = attendanceToCsv(data);
    const filename = `attendance_${employeeId}_${stamp}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (err) {
    const code = err.statusCode || 500;
    console.error('[reports/attendance/export]', err);
    return res.status(code).json({ success: false, error: err.message || 'Internal server error' });
  }
}

async function exportRequestsReport(req, res) {
  try {
    const company = getCompanyFromRequest(req);
    if (!company) return res.status(400).json({ success: false, error: 'company is required' });

    const employeeId = firstQueryValue(req.query.employeeId);
    const format = (firstQueryValue(req.query.format) || 'csv').toLowerCase();

    if (!employeeId) {
      return res.status(400).json({ success: false, error: 'employeeId is required' });
    }
    if (format !== 'csv') {
      return res.status(400).json({ success: false, error: 'Only CSV export is supported for requests' });
    }

    const { rows } = await buildRequestsExportRows({ employeeId, company });

    const csv = requestsToCsv({ rows });
    const filename = `leave_requests_${employeeId}_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csv);
  } catch (err) {
    const code = err.statusCode || 500;
    console.error('[reports/requests/export]', err);
    return res.status(code).json({ success: false, error: err.message || 'Internal server error' });
  }
}

module.exports = { exportAttendanceReport, exportRequestsReport };
