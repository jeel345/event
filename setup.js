// Creates the database and upgrades an older CATCH UP database in place (your data is kept).
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const upgrades = [
  "ALTER TABLE events ADD COLUMN type ENUM('individual','group') NOT NULL DEFAULT 'individual'",
  "ALTER TABLE events ADD COLUMN min_team INT NOT NULL DEFAULT 2",
  "ALTER TABLE events ADD COLUMN max_team INT NOT NULL DEFAULT 5",
  "ALTER TABLE registrations MODIFY user_id INT NULL",
  "ALTER TABLE registrations ADD COLUMN team_id INT NULL",
  "ALTER TABLE registrations ADD COLUMN attendee_name VARCHAR(100)",
  "ALTER TABLE registrations ADD COLUMN attendee_email VARCHAR(150)",
  "ALTER TABLE registrations ADD CONSTRAINT fk_reg_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE",
  "ALTER TABLE users ADD COLUMN interests VARCHAR(500) NULL",
  "ALTER TABLE events ADD COLUMN tags VARCHAR(255) NULL",
  "ALTER TABLE events ADD COLUMN lat DECIMAL(9,6) NULL",
  "ALTER TABLE events ADD COLUMN lng DECIMAL(9,6) NULL",
  "ALTER TABLE events ADD COLUMN radius_m INT NOT NULL DEFAULT 150",
  "UPDATE registrations r JOIN users u ON u.id=r.user_id SET r.attendee_name=u.name, r.attendee_email=u.email WHERE r.attendee_name IS NULL"
];
(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', multipleStatements: true
  });
  await c.query(fs.readFileSync('database.sql', 'utf8'));
  await c.query('USE ' + (process.env.DB_NAME || 'catchup'));
  for (const q of upgrades) {
    try { await c.query(q); } catch (e) { if (!/duplicate/i.test(e.message)) throw e; }
  }
  console.log('Database is ready and up to date.');
  process.exit();
})().catch(e => { console.error('Setup failed:', e.message); process.exit(1); });
