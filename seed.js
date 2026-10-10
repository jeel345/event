require('dotenv').config();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./db');
(async () => {
  const adminPw = await bcrypt.hash('admin123', 10);
  const stuPw = await bcrypt.hash('student123', 10);
  await db.query(`INSERT IGNORE INTO users (name,email,password,phone,college,course,role) VALUES
    ('Admin','admin@catchup.com',?,'+91 98765 43210','Atmiya University','Organizer','admin'),
    ('Jeel Solanki','jeelsolanki@gmail.com',?,'+91 98765 43210','Atmiya University','MCA','student')`, [adminPw, stuPw]);
  // Demo interests for the main student account (only filled in if still empty).
  await db.query("UPDATE users SET interests='Coding,AI & Machine Learning,Web Development' WHERE email='jeelsolanki@gmail.com' AND (interests IS NULL OR interests='')");

  const d = (days, h) => { const x = new Date(); x.setDate(x.getDate() + days); x.setHours(h, 0, 0, 0); return x; };
  const ev = [
    ['Tech Fest 2026','Technical','The biggest tech fest of the year: workshops, competitions and expert talks.','Auditorium',d(7,10),d(7,12),150,0,'Coding,Robotics & IoT'],
    ['Cultural Fest','Cultural','Music, dance and drama from every department on one stage.','Main Ground',d(10,18),d(10,22),400,0,'Music,Dance,Drama & Theatre'],
    ['Web Development Workshop','Workshop','A hands-on day building a full-stack app from scratch.','Lab 3',d(14,9),d(14,11),60,0,'Web Development,Coding'],
    ['Sports Day','Sports','Inter-department track and field, cricket and kabaddi.','Sports Complex',d(20,8),d(20,17),300,0,'Sports']
  ];
  const [[{ c }]] = await db.query('SELECT COUNT(*) c FROM events');
  if (!c) for (const e of ev) await db.query('INSERT INTO events (title,category,description,venue,start_at,end_at,seats,fee,tags) VALUES (?,?,?,?,?,?,?,?,?)', e);
  const [[{ h }]] = await db.query("SELECT COUNT(*) h FROM events WHERE title='24-Hour Hackathon'");
  if (!h) await db.query("INSERT INTO events (title,category,description,venue,start_at,end_at,seats,fee,type,min_team,max_team,tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ['24-Hour Hackathon','Technical','Build a working project in 24 hours. Register as a team of 2 to 4; every member gets their own QR pass.','Innovation Lab',d(5,9),d(6,9),40,0,'group',2,4,'Coding,AI & Machine Learning']);

  // More events so the recommendations have something to choose from.
  const more = [
    ['AI & Machine Learning Bootcamp','Workshop','Learn how recommendation systems and chatbots work, then train a small model yourself.','Lab 1',d(9,10),d(9,16),50,0,'AI & Machine Learning,Coding'],
    ['Open Mic Night','Cultural','Sing, play or perform a short act. Everyone is welcome to watch and cheer.','Amphitheatre',d(12,18),d(12,21),120,0,'Music,Public Speaking'],
    ['Startup Pitch Day','Technical','Pitch your idea to a panel of founders and get feedback on your business plan.','Seminar Hall',d(16,11),d(16,15),80,0,'Entrepreneurship,Career & Placements'],
    ['Campus Photography Walk','Cultural','A guided walk around campus with tips on composition, light and mobile photography.','Main Gate',d(8,16),d(8,18),40,0,'Photography,Art & Craft'],
    ['UI/UX Design Sprint','Workshop','Go from a blank page to a clickable prototype in one afternoon using Figma.','Design Studio',d(11,13),d(11,17),35,0,'Design,Web Development']
  ];
  for (const e of more) {
    const [[{ n }]] = await db.query('SELECT COUNT(*) n FROM events WHERE title=?', [e[0]]);
    if (!n) await db.query('INSERT INTO events (title,category,description,venue,start_at,end_at,seats,fee,tags) VALUES (?,?,?,?,?,?,?,?,?)', e);
  }
  // Older databases: give the original events tags without touching ones an organizer already edited.
  for (const e of [...ev, ...more]) await db.query('UPDATE events SET tags=? WHERE title=? AND (tags IS NULL OR tags=\'\')', [e[8], e[0]]);

  // A few demo students with different interests and some registrations, so "students like you" has data to work with.
  const demo = [
    ['Ananya Shah','ananya@demo.com','Coding,AI & Machine Learning',['Tech Fest 2026','AI & Machine Learning Bootcamp','Web Development Workshop']],
    ['Rohan Mehta','rohan@demo.com','Web Development,Design',['Web Development Workshop','UI/UX Design Sprint','Tech Fest 2026']],
    ['Priya Patel','priya@demo.com','Music,Dance',['Cultural Fest','Open Mic Night']],
    ['Karan Desai','karan@demo.com','Sports,Entrepreneurship',['Sports Day','Startup Pitch Day']]
  ];
  for (const [name, email, interests, titles] of demo) {
    await db.query("INSERT IGNORE INTO users (name,email,password,college,course,interests) VALUES (?,?,?,'Atmiya University','BCA',?)", [name, email, stuPw, interests]);
    const [[u]] = await db.query('SELECT id FROM users WHERE email=?', [email]);
    for (const t of titles) {
      const [[e]] = await db.query('SELECT id FROM events WHERE title=? LIMIT 1', [t]);
      if (e) await db.query('INSERT IGNORE INTO registrations (user_id,event_id,pass_code,attendee_name,attendee_email) VALUES (?,?,?,?,?)', [u.id, e.id, 'CU-' + crypto.randomBytes(6).toString('hex').toUpperCase(), name, email]);
    }
  }
  console.log('Seeded. Admin: admin@catchup.com / admin123  |  Student: jeelsolanki@gmail.com / student123');
  process.exit();
})();
