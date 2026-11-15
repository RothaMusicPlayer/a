const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "DELETE"]
    }
});

app.use(cors());
app.use(express.json());

// 🛡️ ការពារ Server ពីការ Spam ឬ DDoS (Rate Limiting)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // រយៈពេល ១៥ នាទី
    max: 150, // កម្រិតអតិបរមា ១៥០ Requests ក្នុងមួយ IP
    message: { success: false, message: "Too many requests from this IP, please try again later." }
});
app.use(limiter);

// ទីតាំងរក្សាទុកទិន្នន័យអចិន្ត្រៃយ៍
const USERS_FILE = path.join(__dirname, 'users.json');
const POSTS_FILE = path.join(__dirname, 'posts.json');

// មុខងារអានទិន្នន័យ Users
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("Error reading users:", e);
    }
    // បង្កើតគណនី admin លំនាំដើម (Username: admin, Password: 123)
    const defaultUsers = { "admin": "123" };
    saveUsers(defaultUsers);
    return defaultUsers;
}

// មុខងាររក្សាទុកទិន្នន័យ Users
function saveUsers(users) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    } catch (e) {
        console.error("Error saving users:", e);
    }
}

// មុខងារអានទិន្នន័យ Posts
function loadPosts() {
    try {
        if (fs.existsSync(POSTS_FILE)) {
            const data = fs.readFileSync(POSTS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("Error reading posts:", e);
    }
    return [];
}

// មុខងាររក្សាទុកទិន្នន័យ Posts
function savePosts(posts) {
    try {
        fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2), 'utf8');
    } catch (e) {
        console.error("Error saving posts:", e);
    }
}

// ចាប់ផ្តើមបង្កើត File ទិន្នន័យបើមិនទាន់មាន
loadUsers();
if (!fs.existsSync(POSTS_FILE)) savePosts([]);

// ================= API ENDPOINTS =================

// 1. Register (បង្កើតគណនីថ្មី)
app.post('/api/register', (req, res) => {
    let { username, password } = req.body;
    username = username ? username.trim().toLowerCase() : '';

    if (!username || !password) {
        return res.json({ success: false, message: "Please enter username and password!" });
    }

    const users = loadUsers();
    if (users[username]) {
        return res.json({ success: false, message: "Username already exists!" });
    }

    users[username] = password;
    saveUsers(users); // រក្សាទុកចូល File ភ្លាមៗ

    res.json({ success: true, username });
});

// 2. Login (ចូលប្រើប្រាស់)
app.post('/api/login', (req, res) => {
    let { username, password } = req.body;
    username = username ? username.trim().toLowerCase() : '';

    const users = loadUsers();
    if (users[username] && users[username] === password) {
        return res.json({ success: true, username });
    }
    res.json({ success: false, message: "Incorrect username or password!" });
});

// 3. Get All Posts (ទាញយកការបង្ហោះទាំងអស់)
app.get('/api/posts', (req, res) => {
    const posts = loadPosts();
    res.json(posts);
});

// 4. Create Post (បង្ហោះវីដេអូថ្មី)
app.post('/api/posts', (req, res) => {
    const newPost = req.body;
    if (!newPost || !newPost.media) {
        return res.status(400).json({ success: false, message: "Invalid post data" });
    }

    const posts = loadPosts();
    newPost.id = Date.now().toString();
    posts.unshift(newPost); // ដាក់បង្ហាញនៅខាងលើគេ
    savePosts(posts); // រក្សាទុកចូល File ភ្លាមៗ

    res.json({ success: true, post: newPost });
});

// 5. Admin: Delete Post (លុបការបង្ហោះ - មានសុវត្ថិភាពផ្ទៀងផ្ទាត់ Admin)
app.delete('/api/posts/:id', (req, res) => {
    const postId = req.params.id;
    const { adminUser } = req.body;

    if (adminUser !== 'admin') {
        return res.status(403).json({ success: false, message: "Unauthorized action!" });
    }

    let posts = loadPosts();
    posts = posts.filter(p => (p.id !== postId) && (String(p.timestamp) !== postId));
    savePosts(posts);

    res.json({ success: true, message: "Post deleted successfully" });
});

// 6. Admin: Get Users List (មើលបញ្ជីអ្នកប្រើប្រាស់)
app.get('/api/admin/users', (req, res) => {
    const { adminUser } = req.query;
    if (adminUser !== 'admin') {
        return res.status(403).json({ success: false, message: "Unauthorized action!" });
    }
    const users = loadUsers();
    res.json({ success: true, users: Object.keys(users) });
});

// 7. Admin: Delete User (លុបគណនីអ្នកប្រើប្រាស់)
app.delete('/api/admin/user', (req, res) => {
    const { adminUser, usernameToDelete } = req.body;

    if (adminUser !== 'admin' || usernameToDelete === 'admin') {
        return res.status(403).json({ success: false, message: "Action not allowed!" });
    }

    let users = loadUsers();
    if (users[usernameToDelete]) {
        delete users[usernameToDelete];
        saveUsers(users);

        // លុប Posts របស់អ្នកប្រើប្រាស់នោះចេញពី Feed ផងដែរ
        let posts = loadPosts();
        posts = posts.filter(p => p.author !== usernameToDelete);
        savePosts(posts);

        return res.json({ success: true, message: "User deleted successfully" });
    }
    res.json({ success: false, message: "User not found" });
});

// ================= SOCKET.IO =================
io.on('connection', (socket) => {
    socket.on('join', (username) => {
        socket.username = username;
    });
});

// ================= START SERVER =================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`QUO Secure Server is running on port ${PORT}`);
});
