const express = require('express');
const XLSX = require('xlsx');
const router = express.Router();
const { connectMongo } = require('../../config/mongo');
const { getCompanyDatabaseName, getDatabaseName, getCollectionName } = require('../../config/database.config');

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

router.get('/assets', async (req, res) => {
  try {
    const companyId = req.query.companyId;
    const company = String(req.query.company || '').trim();
    const id = req.query.id;

    const collection = await getCollection('assets', company || null);

    if (id) {
      const deleted = await collection.deleteOne({ id: String(id) });
      if (!deleted.deletedCount) {
        return res.status(404).json({ success: false, error: 'Asset not found' });
      }
      return res.json({ success: true, message: 'Asset deleted successfully' });
    }

    const baseQuery = {};
    if (companyId) baseQuery.companyId = companyId;

    let assets = [];
    if (company) {
      assets = await collection.find({}).sort({ createdAt: -1 }).toArray();
      // Data written while DB name used "ecosoul_home_*" instead of canonical "ecosoul_*"
      if (assets.length === 0 && company.toLowerCase().includes('ecosoul')) {
        try {
          const legacyName = getLegacyMistakenEcosoulAssetDbName();
          const legacyAssets = await fetchAssetsFromDbName(legacyName, {});
          if (legacyAssets.length) assets = legacyAssets;
        } catch (_e) {
          /* legacy DB may not exist */
        }
      }
      if (assets.length === 0) {
        const sharedCollection = await getCollection('assets');
        const sharedQuery = { ...baseQuery, ...buildCompanyFilter(company) };
        assets = await sharedCollection.find(sharedQuery).sort({ createdAt: -1 }).toArray();
        if (!assets.length && companyId) {
          assets = await sharedCollection.find(buildCompanyFilter(company)).sort({ createdAt: -1 }).toArray();
        }
        // Old docs in shared DB may only have companyId, not company string
        if (!assets.length && companyId) {
          assets = await sharedCollection.find({ companyId }).sort({ createdAt: -1 }).toArray();
        }
      }
    } else {
      assets = await collection.find(baseQuery).sort({ createdAt: -1 }).toArray();
    }

    return res.json({ success: true, data: assets, count: assets.length });
  } catch (error) {
    console.error('[asset-tracker] get assets failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch assets' });
  }
});

router.post('/assets', async (req, res) => {
  try {
    const body = req.body || {};
    const company = body.company || '';
    const collection = await getCollection('assets', company || null);
    const asset = {
      ...body,
      status: body.status && String(body.status).trim() ? body.status : 'available',
      company,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await collection.insertOne(asset);
    await logAssetHistory({
      type: 'created',
      action: 'created',
      companyId: asset.companyId,
      company: asset.company,
      assetId: asset.id,
      assetTag: asset.assetTag,
      description: asset.model || asset.category || '',
    }, company || null);

    return res.json({ success: true, data: { ...asset, _id: result.insertedId }, message: 'Asset created successfully' });
  } catch (error) {
    console.error('[asset-tracker] create asset failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to create asset' });
  }
});

router.put('/assets', async (req, res) => {
  try {
    const body = req.body || {};
    const id = body.id;
    const updateData = { ...body };
    delete updateData.id;
    const company = updateData.company || body.company || '';

    if (!id) return res.status(400).json({ success: false, error: 'Asset ID is required' });
    const idStr = String(id);
    const updatedAt = new Date().toISOString();

    // In production we have data across:
    // - company-scoped DB
    // - legacy ecosoul_home_* DB (older bug)
    // - shared DB (fallback when company DB empty)
    //
    // GET already falls back; PUT must do the same otherwise "Asset not found" happens on updates.
    const baseMatch = { id: idStr };
    const baseQuery = {};
    if (updateData.companyId) baseQuery.companyId = updateData.companyId;
    const companyFilter = company ? buildCompanyFilter(company) : {};

    const tryUpdateInCollection = async (collection, matchExtra = {}) => {
      const match = { ...baseMatch, ...matchExtra };
      const prev = await collection.findOne(match);
      const result = await collection.updateOne(
        match,
        { $set: { ...updateData, updatedAt } }
      );
      return { prev, result };
    };

    // 1) company scoped DB
    const companyCollection = await getCollection('assets', company || null);
    let { prev, result } = await tryUpdateInCollection(companyCollection);

    // 2) legacy mistaken ecosoul_home_* DB
    if (!result?.matchedCount && company && company.toLowerCase().includes('ecosoul')) {
      try {
        const legacyDbName = getLegacyMistakenEcosoulAssetDbName();
        const legacyDb = await connectMongo(legacyDbName);
        const legacyCol = legacyDb.collection(getCollectionName('assets'));
        ({ prev, result } = await tryUpdateInCollection(legacyCol));
      } catch (_e) {
        // legacy DB may not exist
      }
    }

    // 3) shared DB fallback: match by id + (companyId/company) to avoid cross-company updates
    if (!result?.matchedCount) {
      const sharedCollection = await getCollection('assets');
      const sharedExtra = { ...baseQuery, ...companyFilter };
      ({ prev, result } = await tryUpdateInCollection(sharedCollection, sharedExtra));
      // Older docs may only have companyId and not company string; retry with just companyId if needed
      if (!result?.matchedCount && updateData.companyId) {
        ({ prev, result } = await tryUpdateInCollection(sharedCollection, { companyId: updateData.companyId }));
      }
      // Last resort: match only by id in shared DB (kept as final fallback for historical data)
      if (!result?.matchedCount) {
        ({ prev, result } = await tryUpdateInCollection(sharedCollection));
      }
    }

    if (!result?.matchedCount) return res.status(404).json({ success: false, error: 'Asset not found' });

    const prevAssignedTo = prev?.assignedTo || null;
    const nextAssignedTo = updateData.assignedTo ?? prevAssignedTo;
    const prevStatus = (prev?.status || '').toLowerCase();
    const nextStatus = String((updateData.status ?? prevStatus) || '').toLowerCase();

    let type = 'updated';
    let action = 'updated';
    if (!prevAssignedTo && nextAssignedTo) { type = 'checkout'; action = 'checked out'; }
    else if (prevAssignedTo && !nextAssignedTo) { type = 'checkin'; action = 'checked in'; }
    else if (prevAssignedTo && nextAssignedTo && prevAssignedTo !== nextAssignedTo) { type = 'checkout'; action = 're-assigned'; }
    else if (prevStatus !== nextStatus && nextStatus === 'maintenance') { type = 'maintenance'; action = 'moved to maintenance'; }
    else if (prevStatus !== nextStatus && nextStatus === 'broken') { type = 'broken'; action = 'marked broken'; }

    await logAssetHistory({
      type,
      action,
      companyId: updateData.companyId || prev?.companyId,
      company: updateData.company || prev?.company,
      assetId: id,
      assetTag: prev?.assetTag,
      description: prev?.model || prev?.category || '',
      assignedTo: nextAssignedTo,
      assignedFrom: prevAssignedTo,
      status: nextStatus,
      department: updateData.department ?? prev?.department ?? null,
    }, company || prev?.company || null);

    return res.json({ success: true, message: 'Asset updated successfully' });
  } catch (error) {
    console.error('[asset-tracker] update asset failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to update asset' });
  }
});

router.delete('/assets', async (req, res) => {
  try {
    const id = req.query.id;
    const company = req.query.company || '';
    if (!id) return res.status(400).json({ success: false, error: 'Asset ID is required' });

    const collection = await getCollection('assets', company || null);
    const prev = await collection.findOne({ id: String(id) });
    const result = await collection.deleteOne({ id: String(id) });
    if (!result.deletedCount) return res.status(404).json({ success: false, error: 'Asset not found' });

    await logAssetHistory({
      type: 'deleted',
      action: 'deleted',
      companyId: prev?.companyId,
      company: prev?.company,
      assetId: id,
      assetTag: prev?.assetTag,
      description: prev?.model || prev?.category || '',
      assignedTo: prev?.assignedTo || null,
      status: (prev?.status || '').toLowerCase(),
      department: prev?.department || null,
    }, company || prev?.company || null);

    return res.json({ success: true, message: 'Asset deleted successfully' });
  } catch (error) {
    console.error('[asset-tracker] delete asset failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to delete asset' });
  }
});

router.get('/assets/:assetId', async (req, res) => {
  try {
    const assetId = req.params.assetId;
    const companyId = req.query.companyId;
    const company = req.query.company;
    if (!assetId) return res.status(400).json({ success: false, error: 'Asset ID is required' });

    const collection = await getCollection('assets', company || null);
    const query = {
      $or: [
        { id: String(assetId) },
        { _id: String(assetId) },
        { assetTag: String(assetId) },
        { assetTag: { $regex: new RegExp(`^${escapeRegex(String(assetId))}$`, 'i') } },
      ],
    };
    if (companyId) query.companyId = companyId;
    if (company) query.company = { $regex: new RegExp(`^${escapeRegex(company)}$`, 'i') };

    const asset = await collection.findOne(query);
    if (!asset) return res.status(404).json({ success: false, error: 'Asset not found' });
    return res.json({ success: true, data: asset });
  } catch (error) {
    console.error('[asset-tracker] get asset detail failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch asset' });
  }
});

router.get('/history', async (req, res) => {
  try {
    const companyId = req.query.companyId;
    const company = req.query.company;
    const type = String(req.query.type || '').toLowerCase();
    const assetId = req.query.assetId;
    const assetTag = req.query.assetTag;
    const latestOnly = String(req.query.latestOnly) === 'true';
    const limitRaw = Number(req.query.limit || 50);
    const limit = Math.min(Math.max(limitRaw, 1), 200);

    const collection = await getCollection('asset_history', company || null);
    const query = {};
    if (companyId) query.companyId = companyId;
    if (type) query.type = type;
    if (assetId || assetTag) {
      const v = assetId || assetTag;
      query.$or = [{ assetId: v }, { assetTag: v }];
    }

    let items = [];
    if (latestOnly) {
      const allItems = await collection.find(query).sort({ createdAt: -1 }).toArray();
      const latestMap = new Map();
      for (const item of allItems) {
        const key = item.assetId || item.assetTag;
        if (key && !latestMap.has(key)) latestMap.set(key, item);
      }
      items = Array.from(latestMap.values()).slice(0, limit);
    } else {
      items = await collection.find(query).sort({ createdAt: -1 }).limit(limit).toArray();
    }

    return res.json({ success: true, data: items, count: items.length });
  } catch (error) {
    console.error('[asset-tracker] get history failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch asset history' });
  }
});

router.post('/history', async (req, res) => {
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
});

router.get('/settings/categories', async (req, res) => {
  try {
    const companyId = req.query.companyId || 'default';
    const col = await getCollection('asset_categories');
    const doc = await col.findOne({ companyId });
    if (!doc) {
      const categories = defaultCategories();
      await col.insertOne({ companyId, categories, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      return res.json({ success: true, data: { companyId, categories } });
    }
    return res.json({ success: true, data: { companyId, categories: doc.categories || [] } });
  } catch (error) {
    console.error('[asset-tracker] get categories failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch categories' });
  }
});

router.put('/settings/categories', async (req, res) => {
  try {
    const companyId = req.body.companyId || 'default';
    const categories = Array.isArray(req.body.categories) ? req.body.categories : null;
    if (!categories) return res.status(400).json({ success: false, error: 'categories is required (array)' });
    const col = await getCollection('asset_categories');
    await col.updateOne(
      { companyId },
      { $set: { categories, updatedAt: new Date().toISOString() }, $setOnInsert: { createdAt: new Date().toISOString() } },
      { upsert: true }
    );
    return res.json({ success: true, message: 'Categories saved', data: { companyId, categories } });
  } catch (error) {
    console.error('[asset-tracker] save categories failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to save categories' });
  }
});

router.get('/settings/locations', async (req, res) => {
  try {
    const companyId = req.query.companyId || 'default';
    const col = await getCollection('asset_locations');
    const doc = await col.findOne({ companyId });
    if (!doc) {
      const locations = defaultLocations();
      await col.insertOne({ companyId, locations, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      return res.json({ success: true, data: { companyId, locations } });
    }
    return res.json({ success: true, data: { companyId, locations: doc.locations || [] } });
  } catch (error) {
    console.error('[asset-tracker] get locations failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch locations' });
  }
});

router.put('/settings/locations', async (req, res) => {
  try {
    const companyId = req.body.companyId || 'default';
    const locations = Array.isArray(req.body.locations) ? req.body.locations : null;
    if (!locations) return res.status(400).json({ success: false, error: 'locations is required (array)' });
    const col = await getCollection('asset_locations');
    await col.updateOne(
      { companyId },
      { $set: { locations, updatedAt: new Date().toISOString() }, $setOnInsert: { createdAt: new Date().toISOString() } },
      { upsert: true }
    );
    return res.json({ success: true, message: 'Locations saved', data: { companyId, locations } });
  } catch (error) {
    console.error('[asset-tracker] save locations failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to save locations' });
  }
});

router.get('/category-counts', async (req, res) => {
  try {
    const companyId = req.query.companyId;
    const company = req.query.company || null;
    const query = companyId ? { companyId } : {};
    const collection = await getCollection('assets', company);
    const assets = await collection.find(query).toArray();

    const categoryCounts = {};
    const subcategoryCounts = {};
    assets.forEach((asset) => {
      const category = asset.category || 'Unknown';
      const subcategory = asset.subcategory || 'Unknown';
      if (!categoryCounts[category]) categoryCounts[category] = 0;
      categoryCounts[category]++;

      let tagPrefix = '';
      const assetTag = asset.assetTag || '';
      const parts = assetTag.split('-');
      if (parts.length >= 2) tagPrefix = `${parts[0]}-${parts[1]}`;
      if (!tagPrefix) {
        const catPrefix = category.substring(0, 2).toUpperCase();
        const subPrefix = subcategory.substring(0, 3).toUpperCase();
        tagPrefix = `${catPrefix}-${subPrefix}`;
      }
      if (!subcategoryCounts[tagPrefix]) subcategoryCounts[tagPrefix] = 0;
      subcategoryCounts[tagPrefix]++;
    });

    return res.json({ success: true, data: { categoryCounts, subcategoryCounts } });
  } catch (error) {
    console.error('[asset-tracker] category counts failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to fetch category counts' });
  }
});

router.post('/assets/bulk', async (req, res) => {
  try {
    const assets = Array.isArray(req.body.assets) ? req.body.assets : null;
    const company = req.body.company || null;
    if (!assets || assets.length === 0) {
      return res.status(400).json({ success: false, error: 'Assets array is required' });
    }
    const collection = await getCollection('assets', company);
    const assetsWithTimestamps = assets.map((asset) => ({
      ...asset,
      createdAt: asset.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const result = await collection.insertMany(assetsWithTimestamps);
    return res.json({
      success: true,
      insertedCount: result.insertedCount,
      insertedIds: Object.values(result.insertedIds),
      message: `Successfully inserted ${result.insertedCount} assets`,
    });
  } catch (error) {
    console.error('[asset-tracker] bulk insert failed:', error);
    return res.status(500).json({ success: false, error: error.message || 'Failed to bulk insert assets' });
  }
});

router.get('/template', async (_req, res) => {
  const TEMPLATE_COLUMNS = [
    'category', 'subcategory', 'site', 'location', 'brand', 'model', 'serialNumber',
    'assetTag', 'status', 'company', 'description', 'processor', 'processorGeneration',
    'totalRAM', 'ram1Size', 'ram2Size', 'warrantyStart', 'warrantyMonths', 'warrantyExpire',
    'assignedTo', 'department', 'notes',
  ];
  const rows = [
    TEMPLATE_COLUMNS,
    [
      'Computer Assets', 'Laptop', 'Head Office', 'India', 'Dell', 'Latitude 5520', 'DL123456789',
      '', 'available', 'Thrive', 'Developer laptop', 'Intel Core i7', '11th Gen',
      '16GB', '8GB', '8GB', '2025-01-15', '36', '2028-01-15', '', 'IT Department', 'Optional notes',
    ],
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = TEMPLATE_COLUMNS.map((c) => ({ wch: Math.max(14, c.length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Assets');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="asset-upload-template.xlsx"');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(buf);
});

module.exports = router;


