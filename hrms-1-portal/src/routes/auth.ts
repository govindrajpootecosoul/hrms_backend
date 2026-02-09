import express from 'express';
import { mockUsers } from '../data/mockData';

const router = express.Router();

// Mock login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  const user = mockUsers.find(u => u.email === email && u.password === password);

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // In real app, generate JWT token
  const { password: _, ...userWithoutPassword } = user;
  
  res.json({
    success: true,
    user: userWithoutPassword,
    token: `mock_token_${user.id}`, // Mock token
  });
});

// Mock logout
router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// Get current user (mock)
router.get('/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token || !token.startsWith('mock_token_')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userId = token.replace('mock_token_', '');
  const user = mockUsers.find(u => u.id === userId);

  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }

  const { password: _, ...userWithoutPassword } = user;
  res.json({ user: userWithoutPassword });
});

export default router;

