import express from 'express';

const router = express.Router();

// Mock settings
let companySettings = {
  companyName: 'Vectorlytics',
  pan: 'ABCDE1234F',
  tan: 'TAN1234567',
  gst: '29ABCDE1234F1Z5',
  address: '123 Business Street, Bangalore, Karnataka - 560001',
  pfPercentage: 12,
  esiPercentage: 1.75,
  ptRules: {
    state: 'Karnataka',
    slabs: [
      { min: 0, max: 15000, amount: 0 },
      { min: 15001, max: 20000, amount: 150 },
      { min: 20001, max: Infinity, amount: 200 },
    ],
  },
};

router.get('/company', (req, res) => {
  res.json(companySettings);
});

router.put('/company', (req, res) => {
  companySettings = { ...companySettings, ...req.body };
  res.json(companySettings);
});

export default router;

