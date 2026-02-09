import express from 'express';
import { mockJobs, mockCandidates } from '../data/mockData';

const router = express.Router();

router.get('/dashboard', (req, res) => {
  res.json({
    openPositions: mockJobs.filter(j => j.status === 'Open').length,
    candidatesInProcess: mockCandidates.filter(c => ['Applied', 'Screening', 'Interview'].includes(c.stage)).length,
    offersMade: mockCandidates.filter(c => c.stage === 'Offer').length,
    hiresThisMonth: mockCandidates.filter(c => c.stage === 'Joined').length,
  });
});

router.get('/jobs', (req, res) => {
  res.json(mockJobs);
});

router.post('/jobs', (req, res) => {
  const newJob = {
    id: String(mockJobs.length + 1),
    postedDate: new Date().toISOString().split('T')[0],
    ...req.body,
  };
  mockJobs.push(newJob);
  res.status(201).json(newJob);
});

router.get('/candidates', (req, res) => {
  const { stage, position } = req.query;
  
  let filtered = [...mockCandidates];

  if (stage) {
    filtered = filtered.filter(c => c.stage === stage);
  }

  if (position) {
    filtered = filtered.filter(c => c.appliedPosition === position);
  }

  res.json(filtered);
});

router.post('/candidates', (req, res) => {
  const newCandidate = {
    id: String(mockCandidates.length + 1),
    stage: 'Applied',
    ...req.body,
  };
  mockCandidates.push(newCandidate);
  res.status(201).json(newCandidate);
});

router.put('/candidates/:id', (req, res) => {
  const index = mockCandidates.findIndex(c => c.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Candidate not found' });
  }
  mockCandidates[index] = { ...mockCandidates[index], ...req.body };
  res.json(mockCandidates[index]);
});

export default router;

