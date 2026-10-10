<<<<<<< HEAD
# event
=======
# CATCH UP: AI-powered event management for colleges

HTML, CSS, Bootstrap 5, vanilla JS / Node.js, Express, MySQL.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and set `DB_PASSWORD` and `JWT_SECRET` (optionally `ANTHROPIC_API_KEY`)
3. `node setup.js`   (creates the database, or upgrades an older one without losing data)
4. `npm run seed`    (demo accounts and events, including a team event)
5. `npm start` and open http://localhost:3000

Logins: admin `admin@catchup.com` / `admin123`, student `jeelsolanki@gmail.com` / `student123`

## Face check-in (new)

### Student self check-in: face + location (new)

Students sign themselves in from their own phone or laptop. **My events, View pass, "Scan my face and check in"**:
1. The browser asks for location. If the student is **outside the event's allowed radius**, they get a warning ("You are not at the event location, about 1.2 km away") and are **not** signed in.
2. If they are at the venue, the camera scans their face automatically (3 steady frames) and compares it with their saved face. A mismatch means **not signed in**.
3. Both pass: they are checked in, the organizer's counters and scan log update (method "Face + location"), and the pass shows "Checked in".

Rejected attempts (wrong place, face mismatch) appear in the admin scan log as "Not at event location" / "Face did not match".

**Organizer setup:** when creating or editing an event, fill in **Event location**: press "Use my current location" while standing at the venue (or paste latitude and longitude from Google Maps) and choose the allowed radius (default 150 m; use 200 m or more for big campuses, GPS indoors can be off by tens of metres). Events with no location keep working with QR / gate camera only, and students see "use your QR code".

**Rules:** check-in opens 1 hour before the event starts and closes when it ends. The student must have set up their face on their Profile. Run `node setup.js` once to add the new location columns (existing events and data are kept).

**Must know**
- Phones only allow camera and location on **https** (or localhost on the same computer). To test on a phone, open the site through an https address, for example a tunnel such as ngrok or Cloudflare Tunnel, or deploy it with https. `http://192.168.x.x` will be blocked by the phone.
- Browser location can be faked with a mock-GPS app, and there is no liveness test for faces, so treat this as a convenience check. For anything high-stakes, keep a person at the gate with QR / the gate camera.

### Gate camera (organizer scans students)

Students can be recognised by a camera at the gate instead of showing a QR code. QR, pass code and temporary code still work as a backup.

**For students:** Profile, "Face check-in". Tick the agreement, start the camera, take 3 quick captures (straight, slightly left, slightly right). They can re-scan or remove their data on the same page.

**For organizers:** Admin, Attendance, "Face check-in", pick the event and press Start. The line above the camera shows how many registered people have set it up. One person stands in front of the camera at a time. A green banner and sound confirm entry, the live counters and scan log update (method "Face"), and team progress works as before. Duplicates are still blocked, and nobody is matched to an event they did not register for.

**How it works**
- Face reading runs in the browser with face-api.js (`public/js/face.js`). The photo never leaves the device; only a 128-number template is sent.
- Templates are stored in the new `face_templates` table (no images). Matching is done on the server: the best match must be closer than `FACE_MATCH_THRESHOLD` (default 0.5, lower is stricter) and clearly better than the runner-up, otherwise the gate asks for a QR instead of guessing.
- The real check-in goes through the same `doCheckin` function as QR, so duplicate protection and the audit log are unchanged. Unrecognised faces are not written to the scan log.
- Team members who were added by email and have no account cannot enrol, so they use their QR pass.

**Setup:** run `node setup.js` once to create the table. No new npm packages. Needs https or localhost for the camera, and internet on first use (the library and models load from jsDelivr; to run fully offline, copy them into `public/vendor` and edit `LIB` and `MODELS` at the top of `face.js`).

**Be aware**
- This is a convenience check, not a security guarantee. It has no liveness test, so a photo held up to the camera could fool it. Keep a person at the gate and use QR for anything high-stakes.
- A face template is biometric data. Tell students what is stored (the profile page does) and follow your college's data policy. Students can delete their own template, and it is removed automatically if the account is deleted.
- Accuracy depends on light and camera quality. Try it with your real gate camera and adjust `FACE_MATCH_THRESHOLD` if you see too many misses or false matches.

---

## AI and smart features (new)

**1. Events picked for you (AI recommendations)**
- Students choose interests on sign-up or on their profile (15 ready-made topics plus their own).
- Every event has topic tags. The recommender (`recommend.js`) scores each open event for each student using four signals: their interests, the categories and topics of events they registered for or attended (attending counts double), what *similar students* joined (people who share events with them), and timing (spots running out, starting soon).
- Each suggestion shows a match percentage and plain-language reasons, for example "Matches your interest in Coding", "Similar to Tech Fest 2026", "2 students with similar activity joined this".
- Shown on the Home page ("Picked for you") and at the top of the Events page. Logged-out visitors, and students with no signals yet, see "Popular on campus" without a percentage.
- This is a transparent scoring model that needs no training data and runs inside your own server. It gets better as students pick interests and register.

**2. Instant updates**
- A notification bell in the header (students and admin). New notifications arrive live over Server-Sent Events, with a toast and unread badge, and are also saved so nothing is lost if the tab was closed. Full list at `/notifications.html`.
- Students are notified when: they register or their team registers, they are checked in, an event they registered for changes venue/time/title, an event is cancelled, they cancel, an organizer sends an update, and when **a new event matches their interests**.
- "My events" refreshes by itself when a check-in or change comes in.

**3. Faster event creation for organizers**
- **Draft event**: type one line ("2-day hackathon on AI for teams of 3 to 4, around 80 students") and the form is filled in: title, category, description, topics, capacity and team settings. Edit anything, then add date, time and venue.
- Set `ANTHROPIC_API_KEY` in `.env` to have Claude write the draft. Without a key (or if the call fails) a built-in template is used, so creation never breaks.
- **Estimated reach**: while you fill the form, see how many students have interests matching the event.
- **Send update**: one click sends a message to everyone registered for an event.
- **Duplicate** an event to reuse its settings.
- **Dashboard suggestions and "What students are into"**: which topics students follow, topics with no upcoming event, events close to full, events starting soon with few registrations.

### Upgrading an existing database
Run `node setup.js` again. It adds the new columns and the notifications table and keeps your data. `npm run seed` then adds topic tags to the existing events, a few more demo events and four demo students (with interests and registrations) so recommendations show up straight away.

### Trying the AI features (about 3 minutes)
1. Log in as the student (`jeelsolanki@gmail.com`). The Events page shows "Recommended for you" with reasons. Open Profile, change interests, save, and the picks change.
2. Register for "Tech Fest 2026". The bell shows "You are registered", and the recommendations now say "Similar to Tech Fest 2026" and "students with similar activity joined this".
3. Open a second window as admin. Create an event with "Draft event", tag it with a topic the student follows, and save. The student's bell lights up live: "New event for you".
4. As admin, edit the venue of Tech Fest 2026 or press Send update. The student's bell and "My events" update without a refresh.

### Notes
- The live stream passes the login token in the URL (`/api/notifications/stream?token=...`) because browsers cannot send headers on a Server-Sent Events request. Use HTTPS in production.
- Live updates use one open connection per browser tab, which is fine for a college deployment. For very large audiences, put a push service in front.
- Node 18 or newer is required (the AI draft uses the built-in `fetch`).

---

## Original features

## What it does
- Create events with a capacity, individual or team entry (min and max team size).
- Individual registration, or **group registration**: a team leader adds teammates, and every member gets their own unique QR / pass code. The whole team counts against capacity.
- Capacity is enforced inside a database transaction with a row lock, so the last seat can never be double-booked.
- Check-in verifies the code, rejects invalid codes, passes for another event, and **duplicate scans** (the update only succeeds while status is still "registered", so even two simultaneous scans cannot both get in).
- Gate screen: live registered / checked-in / remaining / duplicates-blocked counters, a big green/amber/red result banner with sound and vibration, and a scan audit log.
- Check in one member, or the **whole team in one tap**. Team progress shows as "2 of 4 here".
- Shareable pass links (`/pass.html?code=...`) so a leader can send each teammate their QR, even if the teammate has no account.
- Leaders can cancel a team, which frees every seat. CSV export per event.

## Demo scenario (about 2 minutes)
1. Log in as admin, open Events, create an event with capacity 5 (or use "24-Hour Hackathon").
2. Log in as the student, open the event, register (for a team event: name the team and add teammates).
3. My events, View pass: copy the pass code.
4. Admin, Attendance, pick the event, type the code, Check in. Green banner, counters move.
5. Enter the same code again. Amber banner "Already checked in" with the first scan time, and the scan log shows "Duplicate rejected".
6. Try a made-up code: red "Invalid code".

QR camera scanning needs `localhost` or HTTPS.

## Branding and splash
- Logo files are in `public/img/` (`logo.jpg` full logo, `mark.png` header symbol, `favicon.png`).
- On the first page of each browser session, `public/js/splash.js` shows the full-screen logo for 5 seconds, then reveals the page (the home page when opened at `/`). To see it again, open the site in a new tab or window.
- To change the time, edit `5000` in `splash.js` and `5s` in the `.sp-bar i` rule in `style.css`.
>>>>>>> 2706991 (Stop tracking node_modules)
