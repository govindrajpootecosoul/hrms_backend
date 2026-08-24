const XLSX = require('xlsx');
const { connectMongo } = require('../../../config/mongo');
const { getCompanyDatabaseName, getDatabaseName, getCollectionName } = require('../../../config/database.config');
const { findAcrossCompanies } = require('../lib/mergedAssetDb');

/** Wrong slug used earlier (full "Ecosoul Home" → ecosoul_home_*); read that DB if canonical DB is empty */
function getLegacyMistakenEcosoulAssetDbName() {
  const base = getDatabaseName('assetTracker');
  return `ecosoul_home_${base}`;
}

async function fetchAssetsFromDbName(dbName, baseQuery) {
  const db = await connectMongo(dbName);
  const col = db.collection(getCollectionName('assets'));
  const q = Object.keys(baseQuery).length ? baseQuery : {};
  return col.find(q).sort({ createdAt: -1 }).toArray();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getAssetDb(company = null) {
  const dbName = company ? getCompanyDatabaseName('assetTracker', company) : getDatabaseName('assetTracker');
  return connectMongo(dbName);
}

async function getCollection(collectionKey, company = null) {
  const db = await getAssetDb(company);
  return db.collection(getCollectionName(collectionKey));
}

function buildCompanyFilter(companyName) {
  if (!companyName) return {};
  const normalized = companyName.trim().toLowerCase();
  if (normalized.includes('thrive')) {
    return { $or: [{ company: { $regex: /thrive/i } }, { company: { $regex: /thrivebrands/i } }] };
  }
  if (normalized.includes('ecosoul') || normalized.includes('eco soul')) {
    return { $or: [{ company: { $regex: /ecosoul/i } }, { company: { $regex: /eco\s*soul/i } }] };
  }
  const escaped = escapeRegex(companyName);
  const flexibleSpacing = escaped.replace(/\s+/g, '\\s*');
  return {
    $or: [
      { company: companyName },
      { company: { $regex: new RegExp(`^${flexibleSpacing}$`, 'i') } },
      { company: { $regex: new RegExp(flexibleSpacing, 'i') } },
    ],
  };
}

async function logAssetHistory(entry, company = null) {
  try {
    const historyCollection = await getCollection('asset_history', company);
    await historyCollection.insertOne({ ...entry, createdAt: new Date().toISOString() });
  } catch (err) {
    console.error('[asset-tracker] history write failed:', err.message);
  }
}

function defaultCategories() {
  return [
    {
      id: '1',
      name: 'Computer Assets',
      prefix: 'CA',
      subcategories: [
        { id: '1-1', name: 'Laptop', prefix: 'LAP', tagPrefix: 'CA-LAP' },
        { id: '1-2', name: 'Desktop', prefix: 'DESK', tagPrefix: 'CA-DESK' },
        { id: '1-3', name: 'Server', prefix: 'SRV', tagPrefix: 'CA-SRV' },
      ],
    },
    {
      id: '2',
      name: 'External Equipment',
      prefix: 'EE',
      subcategories: [
        { id: '2-1', name: 'Keyboard', prefix: 'KBD', tagPrefix: 'EE-KBD' },
        { id: '2-2', name: 'Mouse', prefix: 'MSE', tagPrefix: 'EE-MSE' },
        { id: '2-3', name: 'Charger', prefix: 'CHG', tagPrefix: 'EE-CHG' },
        { id: '2-4', name: 'LCD Monitor', prefix: 'LCD', tagPrefix: 'EE-LCD' },
        { id: '2-5', name: 'Bag', prefix: 'BAG', tagPrefix: 'EE-BAG' },
      ],
    },
    {
      id: '3',
      name: 'Office Supplies',
      prefix: 'OS',
      subcategories: [
        { id: '3-1', name: 'Printer', prefix: 'PRT', tagPrefix: 'OS-PRT' },
        { id: '3-2', name: 'Scanner', prefix: 'SCN', tagPrefix: 'OS-SCN' },
      ],
    },
  ];
}

function defaultLocations() {
  return [
    { id: '1', name: 'Head Office', type: 'Site', address: '', country: '', parentSite: '' },
    { id: '2', name: 'Branch Office', type: 'Site', address: '', country: '', parentSite: '' },
    { id: '3', name: 'Warehouse', type: 'Site', address: '', country: '', parentSite: '' },
    { id: '4', name: 'Floor 1', type: 'Location', address: '', country: '', parentSite: 'Head Office' },
    { id: '5', name: 'Floor 2', type: 'Location', address: '', country: '', parentSite: 'Head Office' },
    { id: '6', name: 'Floor 3', type: 'Location', address: '', country: '', parentSite: 'Head Office' },
  ];
}

async function getHistory(req, res) {
  try {
    const typeRaw = String(req.query.type || '').toLowerCase();
    const type = typeRaw === 'all' ? '' : typeRaw;
    const assetId = req.query.assetId;
    const assetTag = req.query.assetTag;
    const latestOnly = String(req.query.latestOnly) === 'true';
    const limitRaw = Number(req.query.limit || 50);
    const limit = Math.min(Math.max(limitRaw, 1), 200);

    const query = {};
    // Asset Watch: merge Ecosoul + Thrive — do not filter by companyId
    if (type) query.type = type;
    if (assetId || assetTag) {
      const v = assetId || assetTag;
      query.$or = [{ assetId: v }, { assetTag: v }];
    }

    const fetchLimit = latestOnly ? null : Math.min(limit * 2, 400);
    let items = await findAcrossCompanies('asset_history', query, {
      sort: { createdAt: -1 },
      limit: fetchLimit,
    });

    if (latestOnly) {
      const latestMap = new Map();
      for (const item of items) {
        const key = item.assetId || item.assetTag;
        if (key && !latestMap.has(key)) latestMap.set(key, item);
      }
      items = Array.from(latestMap.values()).slice(0, limit);
    } else {
      items = items.slice(0, limit);
    }

    return res.json({ success: true, data: items, count: items.length });
  } catch (error) {
    console.error('[asset-tracker] get history failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch asset history' });
  }
}

async function addHistory(req, res) {
  try {
    const body = req.body || {};
    const collection = await getCollection('asset_history', body.company || null);
    const historyItem = { ...body, type: String(body.type || '').toLowerCase(), createdAt: new Date().toISOString() };
    const result = await collection.insertOne(historyItem);
    return res.json({ success: true, data: { ...historyItem, _id: result.insertedId } });
  } catch (error) {
    console.error('[asset-tracker] create history failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to create asset history' });
  }
}

module.exports = {
  getHistory,
  addHistory,
};
