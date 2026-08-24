/**
 * Asset Watch portal only: Ecosoul Home + Thrive share one inventory view.
 * Other portals must keep using single-tenant company scoping.
 */
const { connectMongo } = require('../../../config/mongo');
const { getCollectionName } = require('../../../config/database.config');

const ASSET_PORTAL_COMPANIES = ['Ecosoul Home', 'Thrive'];

async function getCollectionForCompany(collectionKey, company) {
  const db = await connectMongo(company);
  return db.collection(getCollectionName(collectionKey));
}

/**
 * Fetch documents from both company DBs and merge (newest first by createdAt).
 * Does not filter by companyId — inventory is shared across Ecosoul + Thrive.
 */
async function findAcrossCompanies(collectionKey, query = {}, { sort = { createdAt: -1 }, limit = null } = {}) {
  const results = await Promise.all(
    ASSET_PORTAL_COMPANIES.map(async (company) => {
      try {
        const col = await getCollectionForCompany(collectionKey, company);
        let cursor = col.find(query || {}).sort(sort);
        if (limit) cursor = cursor.limit(limit);
        const docs = await cursor.toArray();
        return docs.map((doc) => ({
          ...doc,
          company: doc.company || company,
          _sourceCompany: company,
        }));
      } catch (err) {
        console.error(`[asset-tracker] merge read failed for ${company}/${collectionKey}:`, err.message);
        return [];
      }
    })
  );

  const merged = results.flat();
  merged.sort((a, b) => {
    const ta = new Date(a.createdAt || 0).getTime();
    const tb = new Date(b.createdAt || 0).getTime();
    return tb - ta;
  });
  return merged;
}

/**
 * Find one document by trying each company DB (optional preferred company first).
 */
async function findOneAcrossCompanies(collectionKey, query, preferredCompany = null) {
  const order = [];
  if (preferredCompany) {
    const preferred = ASSET_PORTAL_COMPANIES.find(
      (c) => c.toLowerCase() === String(preferredCompany).trim().toLowerCase()
        || String(preferredCompany).toLowerCase().includes(c.toLowerCase().split(' ')[0])
    );
    if (preferred) order.push(preferred);
  }
  for (const c of ASSET_PORTAL_COMPANIES) {
    if (!order.includes(c)) order.push(c);
  }

  for (const company of order) {
    try {
      const col = await getCollectionForCompany(collectionKey, company);
      const doc = await col.findOne(query);
      if (doc) {
        return {
          doc: { ...doc, company: doc.company || company, _sourceCompany: company },
          company,
          collection: col,
        };
      }
    } catch (err) {
      console.error(`[asset-tracker] merge findOne failed for ${company}/${collectionKey}:`, err.message);
    }
  }
  return null;
}

module.exports = {
  ASSET_PORTAL_COMPANIES,
  getCollectionForCompany,
  findAcrossCompanies,
  findOneAcrossCompanies,
};
