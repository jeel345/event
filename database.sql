CREATE DATABASE IF NOT EXISTS catchup;
USE catchup;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  college VARCHAR(150),
  course VARCHAR(100),
  role ENUM('student','admin') DEFAULT 'student',
  interests VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  category ENUM('Technical','Cultural','Sports','Workshop') NOT NULL,
  description TEXT,
  venue VARCHAR(150),
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  seats INT NOT NULL DEFAULT 100,
  fee DECIMAL(8,2) NOT NULL DEFAULT 0,
  type ENUM('individual','group') NOT NULL DEFAULT 'individual',
  min_team INT NOT NULL DEFAULT 2,
  max_team INT NOT NULL DEFAULT 5,
  tags VARCHAR(255) NULL,
  lat DECIMAL(9,6) NULL,
  lng DECIMAL(9,6) NULL,
  radius_m INT NOT NULL DEFAULT 150,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teams (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  leader_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY team_name_per_event (event_id, name),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (leader_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS registrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  event_id INT NOT NULL,
  team_id INT NULL,
  attendee_name VARCHAR(100),
  attendee_email VARCHAR(150),
  pass_code VARCHAR(40) NOT NULL UNIQUE,
  status ENUM('registered','checked_in') DEFAULT 'registered',
  checked_in_at DATETIME NULL,
  method VARCHAR(20) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY one_per_event (user_id, event_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  registration_id INT NULL,
  event_id INT NULL,
  code VARCHAR(40),
  result VARCHAR(20) NOT NULL,
  method VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (event_id, id)
);

CREATE TABLE IF NOT EXISTS temp_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id INT NOT NULL,
  code VARCHAR(10) NOT NULL,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100), email VARCHAR(150), message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(30) NOT NULL,
  title VARCHAR(150) NOT NULL,
  body VARCHAR(500),
  link VARCHAR(200),
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Face check-in: one numeric template (a few 128-number vectors) per student. No photos are stored.
CREATE TABLE IF NOT EXISTS face_templates (
  user_id INT PRIMARY KEY,
  descriptors TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
