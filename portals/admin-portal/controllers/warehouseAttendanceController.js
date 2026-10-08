const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { parquetReadObjects } = require('hyparquet');
const { BlobServiceClient } = require('@azure/storage-blob');
const { getWarehouseUsersCollection } = require('../../../config/mongo');

const ATTENDANCE_FIELDS = [
  'attendance_date',
  'employee_code',
  'employee_name',
  'shift',
  'in_time',
  'out_time',
  'work_duration',
  'overtime',
  'total_duration',
  'status',
  'remarks',
];

const DEFAULT_AZURE_PARQUET_URL =
  'https://thriveclientdatabase.blob.core.windows.net/thrive-client-ecosoulhome/sanity_data/wh_employee_attendance/wh_employee_attendance.parquet';

function getSourceConfig() {
  const sourceUrl = (
    process.env.WAREHOUSE_ATTENDANCE_SOURCE_URL ||
    process.env.WAREHOUSE_ATTENDANCE_CSV_PATH ||
    DEFAULT_AZURE_PARQUET_URL
  ).trim();

  const sasToken = (process.env.WAREHOUSE_ATTENDANCE_SAS_TOKEN || '').trim().replace(/^\?/, '');
  const connectionString = (
    process.env.AZURE_CONNECTION_STRING ||
    process.env.WAREHOUSE_AZURE_STORAGE_CONNECTION_STRING ||
    process.env.AZURE_STORAGE_CONNECTION_STRING ||
    ''
  ).trim();

  return { sourceUrl, sasToken, connectionString };
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function isParquetSource(value) {
  const clean = String(value || '').split('?')[0].toLowerCase();
  return clean.endsWith('.parquet');
}

function withSas(url, sasToken) {
  if (!sasToken) return url;
  if (/[?&]sig=/i.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${sasToken}`;
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function cellToString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  // Arrow / parquet timestamp objects
  if (typeof value === 'object' && value && typeof value.toISOString === 'function') {
    try {
      return cellToString(new Date(value.toISOString()));
    } catch (_e) {
      // fall through
    }
  }
  return String(value).trim();
}

/**
 * Preserve source date text as-is when possible.
 * Excel serials / Date objects → YYYY-MM-DD; otherwise keep the string unchanged.
 */
function normalizeAttendanceDate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return cellToString(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Epoch ms vs Excel serial heuristic
    if (value > 10000000000) {
      return cellToString(new Date(value));
    }
    if (value > 20000 && value < 80000) {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) {
        const y = parsed.y;
        const m = String(parsed.m).padStart(2, '0');
        const d = String(parsed.d).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    }
    return cellToString(new Date(value));
  }
  return String(value).trim();
}

function mapRow(rawRow) {
  const normalized = {};
  for (const [key, value] of Object.entries(rawRow || {})) {
    normalized[normalizeHeader(key)] = value;
  }

  const doc = {};
  for (const field of ATTENDANCE_FIELDS) {
    if (field === 'attendance_date') {
      doc[field] = normalizeAttendanceDate(normalized[field]);
    } else if (field === 'employee_code') {
      doc[field] = cellToString(normalized[field]);
    } else {
      doc[field] = cellToString(normalized[field]);
    }
  }
  return doc;
}

function parseAzureBlobUrl(blobUrl) {
  const u = new URL(blobUrl.split('?')[0]);
  const hostParts = u.hostname.split('.');
  const accountName = hostParts[0];
  const parts = u.pathname.replace(/^\/+/, '').split('/');
  const containerName = parts.shift();
  const blobName = parts.join('/');
  if (!accountName || !containerName || !blobName) {
    const err = new Error(`Invalid Azure blob URL: ${blobUrl}`);
    err.statusCode = 400;
    throw err;
  }
  return { accountName, containerName, blobName, origin: `${u.protocol}//${u.host}` };
}

async function downloadAzureBlobBuffer(sourceUrl, { sasToken, connectionString }) {
  const { containerName, blobName, origin } = parseAzureBlobUrl(sourceUrl);

  if (connectionString) {
    const service = BlobServiceClient.fromConnectionString(connectionString);
    const container = service.getContainerClient(containerName);
    const blob = container.getBlobClient(blobName);
    const download = await blob.download(0);
    const chunks = [];
    for await (const chunk of download.readableStreamBody) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  // Public URL or SAS-authenticated URL
  const fetchUrl = withSas(sourceUrl, sasToken);
  const res = await fetch(fetchUrl);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(
      `Failed to download warehouse attendance parquet (${res.status}): ${body || res.statusText}. ` +
        `Set WAREHOUSE_ATTENDANCE_SAS_TOKEN or WAREHOUSE_AZURE_STORAGE_CONNECTION_STRING if the blob is private.`
    );
    err.statusCode = res.status === 409 || res.status === 403 || res.status === 401 ? 403 : 502;
    throw err;
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

function bufferToAsyncBuffer(buffer) {
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return {
    byteLength: buffer.byteLength,
    async slice(start, end) {
      return ab.slice(start, end);
    },
  };
}

async function readAttendanceRowsFromParquetBuffer(buffer) {
  const file = bufferToAsyncBuffer(buffer);
  const objects = await parquetReadObjects({ file });
  return (objects || [])
    .map(mapRow)
    .filter((row) => row.attendance_date || row.employee_code || row.employee_name);
}

function readAttendanceRowsFromLocalFile(filePath) {
  if (!fs.existsSync(filePath)) {
    const err = new Error(`Attendance file not found at: ${filePath}`);
    err.statusCode = 404;
    throw err;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.parquet') {
    // sync wrapper not used — parquet path goes through async reader
    const err = new Error('Local parquet must be read asynchronously');
    err.statusCode = 500;
    throw err;
  }

  // For CSV: read as text so attendance_date stays exactly as in the file
  const workbook =
    ext === '.csv'
      ? XLSX.read(fs.readFileSync(filePath, 'utf8'), { type: 'string', raw: true })
      : XLSX.readFile(filePath, { cellDates: true, raw: false });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    const err = new Error('Attendance file has no sheets');
    err.statusCode = 400;
    throw err;
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: ext === '.csv',
  });
  return rows.map(mapRow).filter((row) => row.attendance_date || row.employee_code || row.employee_name);
}

async function readAttendanceRows(sourceUrl, auth) {
  if (isHttpUrl(sourceUrl) && isParquetSource(sourceUrl)) {
    const buffer = await downloadAzureBlobBuffer(sourceUrl, auth);
    return readAttendanceRowsFromParquetBuffer(buffer);
  }

  if (isHttpUrl(sourceUrl)) {
    const fetchUrl = withSas(sourceUrl, auth.sasToken);
    const res = await fetch(fetchUrl);
    if (!res.ok) {
      const err = new Error(`Failed to download attendance source (${res.status})`);
      err.statusCode = 502;
      throw err;
    }
    const text = await res.text();
    const workbook = XLSX.read(text, { type: 'string', raw: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
    return rows.map(mapRow).filter((row) => row.attendance_date || row.employee_code || row.employee_name);
  }

  // Local path
  if (isParquetSource(sourceUrl)) {
    const buffer = fs.readFileSync(sourceUrl);
    return readAttendanceRowsFromParquetBuffer(buffer);
  }

  return readAttendanceRowsFromLocalFile(sourceUrl);
}

async function listWarehouseAttendance(req, res) {
  try {
    const col = await getWarehouseUsersCollection();
    const { status, shift, q, date } = req.query;

    const query = { recordType: 'warehouse_attendance' };
    if (status && String(status).trim() && String(status) !== 'All Status') {
      query.status = String(status).trim();
    }
    if (shift && String(shift).trim() && String(shift) !== 'All Shifts') {
      query.shift = String(shift).trim();
    }
    if (date && String(date).trim()) {
      query.attendance_date = String(date).trim();
    }
    if (q && String(q).trim()) {
      const term = String(q).trim();
      query.$or = [
        { employee_name: { $regex: term, $options: 'i' } },
        { employee_code: { $regex: term, $options: 'i' } },
        { remarks: { $regex: term, $options: 'i' } },
      ];
    }

    const records = await col
      .find(query)
      .sort({ attendance_date: 1, employee_code: 1 })
      .toArray();

    const mapped = records.map((row) => ({
      id: row._id?.toString(),
      _id: row._id?.toString(),
      attendance_date: row.attendance_date || '',
      employee_code: row.employee_code || '',
      employee_name: row.employee_name || '',
      shift: row.shift || '',
      in_time: row.in_time || '',
      out_time: row.out_time || '',
      work_duration: row.work_duration || '',
      overtime: row.overtime || '',
      total_duration: row.total_duration || '',
      status: row.status || '',
      remarks: row.remarks || '',
      updatedAt: row.updatedAt || null,
    }));

    const present = mapped.filter((r) => String(r.status).toLowerCase() === 'present').length;
    const absent = mapped.filter((r) => String(r.status).toLowerCase() === 'absent').length;
    const halfDay = mapped.filter((r) => String(r.status).toLowerCase().includes('half')).length;

    return res.json({
      success: true,
      count: mapped.length,
      stats: {
        total: mapped.length,
        present,
        absent,
        halfDay,
      },
      records: mapped,
      source: getSourceConfig().sourceUrl,
    });
  } catch (error) {
    console.error('[warehouse-attendance] list error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to list warehouse attendance',
    });
  }
}

async function refreshWarehouseAttendanceFromCsv(req, res) {
  const { sourceUrl, sasToken, connectionString } = getSourceConfig();
  try {
    const rows = await readAttendanceRows(sourceUrl, { sasToken, connectionString });
    if (!rows.length) {
      return res.status(400).json({
        success: false,
        error: 'No attendance rows found in the source file',
        path: sourceUrl,
      });
    }

    const now = new Date();
    const sourceLabel = isHttpUrl(sourceUrl)
      ? sourceUrl.split('?')[0].split('/').pop()
      : path.basename(sourceUrl);

    const docs = rows.map((row) => ({
      ...row,
      recordType: 'warehouse_attendance',
      sourceFile: sourceLabel,
      sourcePath: sourceUrl.split('?')[0],
      sourceFormat: isParquetSource(sourceUrl) ? 'parquet' : 'csv',
      updatedAt: now,
      createdAt: now,
    }));

    const col = await getWarehouseUsersCollection();

    await col.deleteMany({ recordType: 'warehouse_attendance' });
    const insertResult = await col.insertMany(docs, { ordered: false });

    try {
      await col.createIndex(
        { recordType: 1, attendance_date: 1, employee_code: 1 },
        { name: 'warehouse_attendance_date_code', background: true }
      );
    } catch (_e) {
      // ignore index races
    }

    return res.json({
      success: true,
      message: 'Warehouse attendance refreshed from Azure parquet',
      path: sourceUrl.split('?')[0],
      format: isParquetSource(sourceUrl) ? 'parquet' : 'csv',
      inserted: insertResult.insertedCount ?? docs.length,
      count: docs.length,
    });
  } catch (error) {
    console.error('[warehouse-attendance] refresh error:', error);
    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      error: error.message || 'Failed to refresh warehouse attendance from source',
      path: sourceUrl.split('?')[0],
    });
  }
}

module.exports = {
  listWarehouseAttendance,
  refreshWarehouseAttendanceFromCsv,
  ATTENDANCE_FIELDS,
};
