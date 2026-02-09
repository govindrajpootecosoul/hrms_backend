import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Import routes
import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import employeeRoutes from './routes/employees';
import orgChartRoutes from './routes/orgChart';
import attendanceRoutes from './routes/attendance';
import recruitmentRoutes from './routes/recruitment';
import reportsRoutes from './routes/reports';
import expensesRoutes from './routes/expenses';
import settingsRoutes from './routes/settings';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 7009;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/org-chart', orgChartRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/recruitment', recruitmentRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/expenses', expensesRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'HRMS API Server is running' });
});

app.listen(PORT, () => {
  console.log(`🚀 HRMS Backend Server running on http://localhost:${PORT}`);
});

