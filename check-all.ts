import { config } from 'dotenv';
config({ path: '.env' });
import { Pool } from 'pg';

// Tables that need dropping because their schemas changed too much for Drizzle
// to handle gracefully. Data will be lost.
const tablesToDrop = [
  'event_triggers',
  'communication_read_receipts',
  'message_templates',
  'employee_training_records',
  'break_compliance_rules',
  'cost_records',
  'temperature_logs',
  'kpi_definitions',
  'kpi_logs',
  'goal_definitions',
  'goal_logs',
  'incident_reports',
  'incident_logs',
  'schedule_change_logs',
  'shift_approval_logs',
  'notification_preferences',
  'compliance_alerts',
  'compliance_documents',
  'todo_items',
  'workflow_schedules',
  'workflow_assignments',
  'workflow_instance_steps',
  'workflow_instances',
  'workflow_templates',
  'break_logs',
  'salary_history',
  'payroll_periods',
  'attendance_adjustments',
  'attendance_records',
  'shift_swaps',
  'time_off_requests',
  'shift_approvals',
  'shift_sessions',
  'employee_onboarding',
  'employee_offboarding',
  'employee_documents',
  'employee_communications',
  'notifications',
  'audit_logs',
  'holidays',
  'users',
  'branches',
  'companies',
  'session',
  'sessions',
  'verification',
  'magic_links'
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // First, let's just find which tables have issues by checking if they exist
  const existingRes = await pool.query(
    `SELECT table_name FROM information_schema.tables 
     WHERE table_schema = 'public' 
     ORDER BY table_name`
  );
  const existingTables = existingRes.rows.map(r => r.table_name);
  console.log('Existing tables:', existingTables.join(', '));

  // Check message_templates schema vs code
  const mt = await pool.query(
    `SELECT column_name FROM information_schema.columns 
     WHERE table_name = 'message_templates' AND table_schema = 'public' 
     ORDER BY ordinal_position`
  );
  console.log('message_templates columns:', mt.rows.map(r => r.column_name).join(', '));

  await pool.end();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
