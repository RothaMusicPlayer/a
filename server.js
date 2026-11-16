const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "DELETE"] }
});

const db = new sqlite3.Database('./quo.db', (err) => {
  if (err) console.error('Database opening error: ', err.message);
  else console.log('Connected to SQLite database.');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password TEXT,
    bio TEXT DEFAULT '',
    avatar TEXT DEFAULT ''
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT,
    text TEXT,
    media TEXT,
    mediaType TEXT,
    time TEXT,
    timestamp INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS likes (
    postId INTEGER,
    username TEXT,
    PRIMARY KEY(postId, username)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    postId INTEGER,
    username TEXT,
    comment TEXT,
    time TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS followers (
    follower TEXT,
    following TEXT,
    PRIMARY KEY(follower, following)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT,
    receiver TEXT,
    message TEXT,
    time TEXT
  )`);

  // Ensure default admin user
  db.get("SELECT * FROM users WHERE username = 'admin'", (err, row) => {
    if (!row) {
      db.run("INSERT INTO users (username, password, bio, avatar) VALUES ('admin', 'admin123', 'System Administrator', '')");
    }
  });
});

// Root health check
app.get('/', (req, res) => {
  res.send('QUO Server is running!');
});

// Auth Endpoints
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, message: 'Missing fields' });
  
  db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username.toLowerCase(), password], function(err) {
    if (err) return res.json({ success: false, message: 'Username already taken' });
    res.json({ success: true, username: username.toLowerCase() });
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username.toLowerCase(), password], (err, row) => {
    if (err || !row) return res.json({ success: false, message: 'Invalid credentials' });
    res.json({ success: true, username: row.username });
  });
});

// User profile & update
app.get('/api/user/:username', (req, res) => {
  db.get("SELECT username, bio, avatar FROM users WHERE username = ?", [req.params.username], (err, row) => {
    if (err || !row) return res.json({ success: false });
    res.json({ success: true, user: row });
  });
});

app.post('/api/user/update', (req, res) => {
  const { username, bio, avatar } = req.body;
  db.run("UPDATE users SET bio = ?, avatar = ? WHERE username = ?", [bio, avatar, username], function(err) {
    if (err) return res.json({ success: false });
    res.json({ success: true });
  });
});

// Posts API
app.get('/api/posts', (req, res) => {
  db.all("SELECT * FROM posts ORDER BY timestamp DESC", [], (err, rows) => {
    if (err) return res.json([]);
    res.json(rows);
  });
});

app.post('/api/posts', (req, res) => {
  const { author, text, media, mediaType, time, timestamp } = req.body;
  db.run("INSERT INTO posts (author, text, media, mediaType, time, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
    [author, text || '', media || '', mediaType || 'iframe', time, timestamp], function(err) {
      if (err) return res.json({ success: false });
      res.json({ success: true, id: this.lastID });
    });
});

app.delete('/api/posts/:id', (req, res) => {
  const { adminUser } = req.body;
  const postId = req.params.id;
  if (adminUser !== 'admin') return res.json({ success: false, message: 'Unauthorized' });

  db.run("DELETE FROM posts WHERE id = ?", [postId], function(err) {
    if (err) return res.json({ success: false });
    db.run("DELETE FROM likes WHERE postId = ?", [postId]);
    db.run("DELETE FROM comments WHERE postId = ?", [postId]);
    res.json({ success: true });
  });
});

// Likes API
app.get('/api/posts/:id/likes', (req, res) => {
  const postId = req.params.id;
  db.all("SELECT username FROM likes WHERE postId = ?", [postId], (err, rows) => {
    if (err) return res.json({ count: 0 });
    res.json({ count: rows.length, users: rows.map(r => r.username) });
  });
});

app.post('/api/posts/:id/like', (req, res) => {
  const postId = req.params.id;
  const { username } = req.body;
  db.get("SELECT * FROM likes WHERE postId = ? AND username = ?", [postId, username], (err, row) => {
    if (row) {
      db.run("DELETE FROM likes WHERE postId = ? AND username = ?", [postId, username], () => {
        res.json({ success: true, liked: false });
      });
    } else {
      db.run("INSERT INTO likes (postId, username) VALUES (?, ?)", [postId, username], () => {
        res.json({ success: true, liked: true });
      });
    }
  });
});

// Comments API
app.get('/api/posts/:id/comments', (req, res) => {
  db.all("SELECT * FROM comments WHERE postId = ? ORDER BY id DESC", [req.params.id], (err, rows) => {
    if (err) return res.json([]);
    res.json(rows);
  });
});

app.post('/api/posts/:id/comments', (req, res) => {
  const postId = req.params.id;
  const { username, comment, time } = req.body;
  db.run("INSERT INTO comments (postId, username, comment, time) VALUES (?, ?, ?, ?)", [postId, username, comment, time], function(err) {
    if (err) return res.json({ success: false });
    res.json({ success: true, id: this.lastID });
  });
});

// Chat History API
app.get('/api/messages/:user1/:user2', (req, res) => {
  const { user1, user2 } = req.params;
  db.all(
    "SELECT * FROM messages WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) ORDER BY id ASC",
    [user1, user2, user2, user1],
    (err, rows) => {
      if (err) return res.json([]);
      res.json(rows);
    }
  );
});

// Admin Users API
app.get('/api/admin/users', (req, res) => {
  const { adminUser } = req.query;
  if (adminUser !== 'admin') return res.json({ success: false, message: 'Unauthorized' });
  db.all("SELECT username FROM users", [], (err, rows) => {
    if (err) return res.json({ success: false });
    res.json({ success: true, users: rows.map(r => r.username) });
  });
});

app.delete('/api/admin/user', (req, res) => {
  const { adminUser, usernameToDelete } = req.body;
  if (adminUser !== 'admin' || usernameToDelete === 'admin') return res.json({ success: false, message: 'Unauthorized' });

  db.run("DELETE FROM users WHERE username = ?", [usernameToDelete], () => {
    db.run("DELETE FROM posts WHERE author = ?", [usernameToDelete]);
    db.run("DELETE FROM likes WHERE username = ?", [usernameToDelete]);
    db.run("DELETE FROM comments WHERE username = ?", [usernameToDelete]);
    res.json({ success: true });
  });
});

// Socket.io Real-time Chat
io.on('connection', (socket) => {
  socket.on('join', (username) => {
    socket.join(username);
  });

  socket.on('send_message', (data) => {
    const { sender, receiver, message, time } = data;
    db.run("INSERT INTO messages (sender, receiver, message, time) VALUES (?, ?, ?, ?)", [sender, receiver, message, time], () => {
      io.to(receiver).emit('receive_message', data);
      io.to(sender).emit('receive_message', data);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`QUO Server running on port ${PORT}`));
