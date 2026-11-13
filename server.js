const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());

// ភ្ជាប់ SQLite Database
const db = new sqlite3.Database('./quo.db', (err) => {
    if (err) console.error('Database connection error:', err.message);
    else console.log('Connected to SQLite Database.');
});

// បង្កើត Tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        avatar TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author TEXT,
        text TEXT,
        media TEXT,
        mediaType TEXT,
        isPrivate INTEGER DEFAULT 0,
        time TEXT,
        timestamp INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT,
        receiver TEXT,
        text TEXT,
        time TEXT,
        timestamp INTEGER,
        isRead INTEGER DEFAULT 0
    )`);
});

// API: Register
app.post('/api/register', async (req, res) => {
    let { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: "Missing fields" });
    username = username.trim().toLowerCase();

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hashedPassword], function(err) {
            if (err) {
                return res.status(400).json({ success: false, message: "Username already taken!" });
            }
            res.json({ success: true, message: "Registered successfully!" });
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// API: Login
app.post('/api/login', (req, res) => {
    let { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: "Missing fields" });
    username = username.trim().toLowerCase();

    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err || !user) {
            return res.status(400).json({ success: false, message: "User not found!" });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "Incorrect password!" });
        }
        res.json({ success: true, username: user.username, avatar: user.avatar });
    });
});

// API: Lấy danh sách Users
app.get('/api/users', (req, res) => {
    db.all(`SELECT username FROM users`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// API: Lấy danh sách Posts
app.get('/api/posts', (req, res) => {
    db.all(`SELECT * FROM posts ORDER BY timestamp DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// API: Tạo Post mới
app.post('/api/posts', (req, res) => {
    const { author, text, media, mediaType, isPrivate, time, timestamp } = req.body;
    db.run(`INSERT INTO posts (author, text, media, mediaType, isPrivate, time, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [author, text, media, mediaType, isPrivate ? 1 : 0, time, timestamp], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, postId: this.lastID });
        }
    );
});

// API: Lấy lịch sử tin nhắn
app.get('/api/messages', (req, res) => {
    const { user1, user2 } = req.query;
    db.all(`SELECT * FROM messages WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) ORDER BY timestamp ASC`,
        [user1, user2, user2, user1], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

// Socket.io Realtime Chat
io.on('connection', (socket) => {
    socket.on('join', (username) => {
        if (username) socket.join(username.toLowerCase());
    });

    socket.on('send_message', (data) => {
        db.run(`INSERT INTO messages (sender, receiver, text, time, timestamp, isRead) VALUES (?, ?, ?, ?, ?, 0)`,
            [data.sender.toLowerCase(), data.receiver.toLowerCase(), data.text, data.time, data.timestamp],
            function(err) {
                if (!err) {
                    io.to(data.receiver.toLowerCase()).emit('receive_message', data);
                }
            }
        );
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
