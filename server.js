const express = require('express');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Database
const db = new DatabaseSync(path.join(__dirname, 'database.db'));
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        avatar TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ratings (
        user_id INTEGER NOT NULL,
        tool_id INTEGER NOT NULL,
        value INTEGER NOT NULL CHECK(value BETWEEN 1 AND 5),
        PRIMARY KEY (user_id, tool_id)
    );
    CREATE TABLE IF NOT EXISTS favorites (
        user_id INTEGER NOT NULL,
        tool_id INTEGER NOT NULL,
        PRIMARY KEY (user_id, tool_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
`);
try { db.exec('ALTER TABLE users ADD COLUMN avatar TEXT'); } catch {}

// Sessions in memory: token -> userId
const sessions = new Map();

function parseCookies(req) {
    const header = req.headers.cookie || '';
    return Object.fromEntries(header.split(';').filter(Boolean).map(c => {
        const [k, ...v] = c.trim().split('=');
        return [k, decodeURIComponent(v.join('='))];
    }));
}

function getUser(req) {
    const token = parseCookies(req).session;
    if (!token || !sessions.has(token)) return null;
    return db.prepare('SELECT id, username, email, avatar, created_at FROM users WHERE id = ?').get(sessions.get(token));
}

function requireAuth(req, res, next) {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Требуется авторизация' });
    req.user = user;
    next();
}

function setSessionCookie(res, token) {
    res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Lax`);
}

// Tools data
const tools = [
    { id: 1, name: 'ChatGPT', category: 'text', desc: 'Универсальный чат-бот для текстов, идей и анализа.', rating: 4.8 },
    { id: 2, name: 'Claude', category: 'text', desc: 'Долгие тексты, эссе и работа с документами.', rating: 4.7 },
    { id: 3, name: 'DeepSeek', category: 'text', desc: 'Мощный open-source ассистент с рассуждениями.', rating: 4.6 },
    { id: 4, name: 'Gemini', category: 'text', desc: 'Мультимодальный помощник от Google.', rating: 4.5 },
    { id: 5, name: 'GitHub Copilot', category: 'code', desc: 'Автодополнение кода прямо в редакторе.', rating: 4.8 },
    { id: 6, name: 'Cursor', category: 'code', desc: 'AI-редактор кода с агентскими возможностями.', rating: 4.7 },
    { id: 7, name: 'Codeium', category: 'code', desc: 'Бесплатный автокомплит для десятков языков.', rating: 4.4 },
    { id: 8, name: 'Tabnine', category: 'code', desc: 'Приватные AI-подсказки для корпоративного кода.', rating: 4.3 },
    { id: 9, name: 'Midjourney', category: 'art', desc: 'Фотореалистичные и художественные генерации.', rating: 4.9 },
    { id: 10, name: 'Stable Diffusion', category: 'art', desc: 'Open-source генератор изображений.', rating: 4.6 },
    { id: 11, name: 'DALL·E 3', category: 'art', desc: 'Генерация картинок по описанию от OpenAI.', rating: 4.5 },
    { id: 12, name: 'Kandinsky', category: 'art', desc: 'Русскоязычная нейросеть для арта.', rating: 4.4 },
    { id: 13, name: 'Runway', category: 'video', desc: 'Генерация и монтаж видео с помощью AI.', rating: 4.6 },
    { id: 14, name: 'Sora', category: 'video', desc: 'Реалистичные ролики по текстовому промпту.', rating: 4.7 },
    { id: 15, name: 'Pika', category: 'video', desc: 'Анимация сцен и создание коротких видео.', rating: 4.4 },
    { id: 16, name: 'Luma Dream Machine', category: 'video', desc: 'Быстрые видеогенерации киношного качества.', rating: 4.5 },
];

// API — auth
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    const exists = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
    if (exists) return res.status(409).json({ error: 'Логин или email уже заняты' });
    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)').run(username, email, hash);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, result.lastInsertRowid);
    setSessionCookie(res, token);
    res.status(201).json({ user: { id: result.lastInsertRowid, username, email, avatar: null } });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Заполните все поля' });
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, user.id);
    setSessionCookie(res, token);
    res.json({ user: { id: user.id, username: user.username, email: user.email, avatar: user.avatar } });
});

app.post('/api/logout', (req, res) => {
    const token = parseCookies(req).session;
    if (token) sessions.delete(token);
    res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
    res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Не авторизован' });
    res.json({ user });
});

app.post('/api/avatar', requireAuth, (req, res) => {
    const { avatar } = req.body || {};
    if (avatar !== null && (typeof avatar !== 'string' || !avatar.startsWith('data:image/') || avatar.length > 1500000)) {
        return res.status(400).json({ error: 'Некорректное изображение' });
    }
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, req.user.id);
    res.json({ ok: true });
});

// API — tools
app.get('/api/tools', (req, res) => {
    const enriched = tools.map(t => {
        const r = db.prepare('SELECT COUNT(*) as n, AVG(value) as avg FROM ratings WHERE tool_id = ?').get(t.id);
        return { ...t, ratingsCount: r.n, userAvg: r.avg ? Math.round(r.avg * 10) / 10 : null };
    });
    res.json({ tools: enriched });
});

app.get('/api/tools/:id', (req, res) => {
    const tool = tools.find(t => t.id === Number(req.params.id));
    if (!tool) return res.status(404).json({ error: 'Не найдено' });
    const r = db.prepare('SELECT COUNT(*) as n, AVG(value) as avg FROM ratings WHERE tool_id = ?').get(tool.id);
    const comments = db.prepare(`
        SELECT c.id, c.text, c.created_at, u.username, u.avatar
        FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.tool_id = ? ORDER BY c.id DESC
    `).all(tool.id);
    const user = getUser(req);
    const myRating = user ? db.prepare('SELECT value FROM ratings WHERE user_id = ? AND tool_id = ?').get(user.id, tool.id) : null;
    const isFav = user ? !!db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND tool_id = ?').get(user.id, tool.id) : false;
    res.json({ tool, ratingsCount: r.n, userAvg: r.avg ? Math.round(r.avg * 10) / 10 : null, comments, myRating: myRating ? myRating.value : 0, isFavorite: isFav });
});

app.post('/api/tools/:id/rate', requireAuth, (req, res) => {
    const toolId = Number(req.params.id);
    const value = Number(req.body && req.body.value);
    if (!tools.find(t => t.id === toolId)) return res.status(404).json({ error: 'Не найдено' });
    if (!Number.isInteger(value) || value < 1 || value > 5) return res.status(400).json({ error: 'Оценка 1–5' });
    db.prepare('INSERT INTO ratings (user_id, tool_id, value) VALUES (?, ?, ?) ON CONFLICT(user_id, tool_id) DO UPDATE SET value = excluded.value').run(req.user.id, toolId, value);
    res.json({ ok: true });
});

app.post('/api/tools/:id/favorite', requireAuth, (req, res) => {
    const toolId = Number(req.params.id);
    if (!tools.find(t => t.id === toolId)) return res.status(404).json({ error: 'Не найдено' });
    const exists = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND tool_id = ?').get(req.user.id, toolId);
    if (exists) {
        db.prepare('DELETE FROM favorites WHERE user_id = ? AND tool_id = ?').run(req.user.id, toolId);
        return res.json({ favorite: false });
    }
    db.prepare('INSERT INTO favorites (user_id, tool_id) VALUES (?, ?)').run(req.user.id, toolId);
    res.json({ favorite: true });
});

app.get('/api/favorites', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT tool_id FROM favorites WHERE user_id = ?').all(req.user.id);
    res.json({ favorites: rows.map(r => tools.find(t => t.id === r.tool_id)).filter(Boolean) });
});

app.post('/api/tools/:id/comment', requireAuth, (req, res) => {
    const toolId = Number(req.params.id);
    const text = (req.body && req.body.text || '').trim();
    if (!tools.find(t => t.id === toolId)) return res.status(404).json({ error: 'Не найдено' });
    if (text.length < 2 || text.length > 500) return res.status(400).json({ error: 'Комментарий 2–500 символов' });
    db.prepare('INSERT INTO comments (tool_id, user_id, text) VALUES (?, ?, ?)').run(toolId, req.user.id, text);
    res.status(201).json({ ok: true });
});

app.listen(PORT, () => {
    console.log(`AI Tools Hub запущен: http://localhost:${PORT}`);
});
