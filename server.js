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
    CREATE TABLE IF NOT EXISTS saved_stacks (
        user_id INTEGER PRIMARY KEY,
        tool_ids TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
// Seed: 24 нейросети
const T = (id, name, domain, category, desc, payment, vpn, url, tags, rating, speed, limits, pros, cons, free, noSignup) =>
    ({ id, name, domain, category, desc, payment, vpn, url, tags, rating, speed, limits, pros, cons, free, noSignup });

const tools = [
    T(1, 'ChatGPT', 'openai.com', 'text', 'Универсальный чат-бот для текстов, идей и анализа.', 'freemium', 'Нужен VPN', 'https://chatgpt.com', ['чат', 'текст', 'ассистент'], 4.8, 'Быстро', 'Бесплатно ~40 запросов/3ч', 'Универсален, плагины', 'Бывает «галлюцинирует»', true, false),
    T(2, 'Claude', 'claude.ai', 'text', 'Долгие тексты, эссе и работа с документами.', 'freemium', 'Нужен VPN', 'https://claude.ai', ['текст', 'эссе', 'документы'], 4.7, 'Средне', 'Бесплатно с лимитом, Pro $20', 'Сильная логика, длинный контекст', 'Меньше плагинов', false, false),
    T(3, 'DeepSeek', 'deepseek.com', 'text', 'Мощный open-source ассистент с рассуждениями.', 'free', 'Без VPN', 'https://chat.deepseek.com', ['текст', 'код', 'reasoning'], 4.6, 'Средне', 'Щедрый бесплатный лимит', 'Открытые веса, математика', 'Пиковые задержки', true, true),
    T(4, 'Gemini', 'gemini.google.com', 'text', 'Мультимодальный помощник от Google.', 'freemium', 'Частично', 'https://gemini.google.com', ['текст', 'мультимодал'], 4.5, 'Быстро', 'Бесплатно с лимитами', 'Интеграция с Google', 'Спорные фильтры', true, false),
    T(5, 'GitHub Copilot', 'github.com', 'code', 'Автодополнение кода прямо в редакторе.', 'paid', 'Без VPN', 'https://github.com/features/copilot', ['код', 'ide', 'автокомплит'], 4.8, 'Очень быстро', '$10/мес', 'Пишет код в IDE', 'Подписка', false, false),
    T(6, 'Cursor', 'cursor.com', 'code', 'AI-редактор кода с агентскими возможностями.', 'freemium', 'Без VPN', 'https://cursor.com', ['код', 'ide', 'агент'], 4.7, 'Быстро', 'Pro $20/мес', 'Понимает весь проект', 'Дорогой', false, false),
    T(7, 'Codeium', 'codeium.com', 'code', 'Бесплатный автокомплит для десятков языков.', 'free', 'Без VPN', 'https://codeium.com', ['код', 'бесплатно'], 4.4, 'Быстро', 'Бесплатно', 'Много языков', 'Меньше фишек', true, false),
    T(8, 'Tabnine', 'tabnine.com', 'code', 'Приватные AI-подсказки для корпоративного кода.', 'freemium', 'Без VPN', 'https://www.tabnine.com', ['код', 'приватность'], 4.3, 'Быстро', 'Бесплатно / Pro $12', 'Локальный режим', 'Скромнее фичи', true, false),
    T(9, 'Midjourney', 'midjourney.com', 'art', 'Фотореалистичные и художественные генерации.', 'paid', 'Нужен VPN', 'https://www.midjourney.com', ['арт', 'картинки'], 4.9, 'Медленно', 'От $10/мес', 'Лучшее качество', 'Нет бесплатного тарифа', false, false),
    T(10, 'Stable Diffusion', 'stability.ai', 'art', 'Open-source генератор изображений.', 'free', 'Без VPN', 'https://stability.ai', ['арт', 'open-source'], 4.6, 'Зависит от GPU', 'Бесплатно', 'Полный контроль', 'Нужен мощный ПК', true, true),
    T(11, 'DALL·E 3', 'openai.com', 'art', 'Генерация картинок по описанию от OpenAI.', 'freemium', 'Нужен VPN', 'https://openai.com/dall-e-3', ['арт', 'картинки'], 4.5, 'Средне', 'Через Plus', 'Следует промпту', 'Платно', false, false),
    T(12, 'Kandinsky', 'kandinsky.ai', 'art', 'Русскоязычная нейросеть для арта.', 'free', 'Без VPN', 'https://fusionbrain.ai', ['арт', 'русский'], 4.4, 'Средне', 'Бесплатно', 'Русский интерфейс', 'Качество ниже топ-1', true, true),
    T(13, 'Runway', 'runwayml.com', 'video', 'Генерация и монтаж видео с помощью AI.', 'freemium', 'Нужен VPN', 'https://runwayml.com', ['видео', 'монтаж'], 4.6, 'Медленно', 'От $15/мес', 'Motion brush, кисти', 'Лимиты кадров', false, false),
    T(14, 'Sora', 'openai.com', 'video', 'Реалистичные ролики по текстовому промпту.', 'paid', 'Нужен VPN', 'https://openai.com/sora', ['видео', 'реализм'], 4.7, 'Медленно', 'По подписке', 'Киношные ролики', 'Ограниченный доступ', false, false),
    T(15, 'Pika', 'pika.art', 'video', 'Анимация сцен и создание коротких видео.', 'freemium', 'Без VPN', 'https://pika.art', ['видео', 'анимация'], 4.4, 'Быстро', '150 кредитов/мес', 'Простой интерфейс', 'Нестабильное качество', true, false),
    T(16, 'Luma Dream Machine', 'lumalabs.ai', 'video', 'Быстрые видеогенерации киношного качества.', 'freemium', 'Без VPN', 'https://lumalabs.ai', ['видео', '3d'], 4.5, 'Быстро', '30 видео/мес', 'Реалистичные движения', 'Очереди в пике', true, false),
    T(17, 'Perplexity', 'perplexity.ai', 'assistant', 'Поисковый ассистент с источниками.', 'freemium', 'Без VPN', 'https://www.perplexity.ai', ['поиск', 'источники'], 4.6, 'Быстро', 'Бесплатно с лимитами', 'Ссылки на источники', 'Меньше креатива', true, false),
    T(18, 'YandexGPT', 'yandex.ru', 'assistant', 'Русскоязычный ассистент от Яндекса.', 'free', 'Без VPN', 'https://ya.ru/gpt', ['русский', 'ассистент'], 4.2, 'Быстро', 'Бесплатно', 'На русском', 'Слабее в коде', true, true),
    T(19, 'Suno', 'suno.com', 'video', 'Генерация музыки и песен по промпту.', 'freemium', 'Без VPN', 'https://suno.com', ['музыка', 'аудио'], 4.5, 'Средне', 'Бесплатно 10 песен/день', 'Песни за минуту', 'Качество плавает', true, false),
    T(20, 'ElevenLabs', 'elevenlabs.io', 'video', 'Реалистичная озвучка и клонирование голоса.', 'freemium', 'Без VPN', 'https://elevenlabs.io', ['голос', 'аудио'], 4.7, 'Быстро', 'Бесплатно 10к символов/мес', 'Естественный голос', 'Лимиты символов', true, false),
    T(21, 'Adobe Firefly', 'firefly.adobe.com', 'art', 'Генерация арта, встроена в Photoshop.', 'freemium', 'Без VPN', 'https://firefly.adobe.com', ['арт', 'дизайн'], 4.4, 'Средне', 'Кредиты в подписке', 'Интеграция с Adobe', 'Требует аккаунт Adobe', true, false),
    T(22, 'Grok', 'grok.com', 'assistant', 'ИИ от xAI с доступом к X.', 'paid', 'Нужен VPN', 'https://grok.com', ['ассистент', 'x'], 4.3, 'Быстро', 'В подписке X Premium', 'Актуальные новости', 'Платно', false, false),
    T(23, 'Tripo AI', 'tripo3d.ai', '3d', 'Текст и фото в 3D-модели.', 'freemium', 'Без VPN', 'https://www.tripo3d.ai', ['3d', 'модели'], 4.3, 'Средне', 'Бесплатные кредиты', 'Быстрый 3D из текста', 'Детали требуют доработки', true, false),
    T(24, 'Kaedim', 'kaedim3d.com', '3d', '2D-картинки в 3D-ассеты для игр.', 'paid', 'Без VPN', 'https://www.kaedim3d.com', ['3d', 'игры'], 4.2, 'Средне', 'От $15/мес', 'Геймдев-ассеты', 'Подписка', false, false),
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

app.post('/api/favorites/import', requireAuth, (req, res) => {
    const ids = Array.isArray(req.body && req.body.toolIds) ? req.body.toolIds.filter(Number.isInteger) : [];
    const valid = ids.filter(id => tools.find(t => t.id === id));
    const stmt = db.prepare('INSERT OR IGNORE INTO favorites (user_id, tool_id) VALUES (?, ?)');
    valid.forEach(id => stmt.run(req.user.id, id));
    res.json({ ok: true, imported: valid.length });
});

app.post('/api/stack', requireAuth, (req, res) => {
    const ids = Array.isArray(req.body && req.body.toolIds) ? req.body.toolIds.filter(Number.isInteger) : [];
    if (!ids.length || ids.length > 10) return res.status(400).json({ error: 'Выберите 1–10 инструментов' });
    db.prepare('INSERT INTO saved_stacks (user_id, tool_ids, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET tool_ids = excluded.tool_ids, updated_at = CURRENT_TIMESTAMP')
        .run(req.user.id, JSON.stringify(ids));
    res.json({ ok: true, count: ids.length });
});

app.get('/api/stack', requireAuth, (req, res) => {
    const row = db.prepare('SELECT tool_ids, updated_at FROM saved_stacks WHERE user_id = ?').get(req.user.id);
    const ids = row ? JSON.parse(row.tool_ids) : [];
    res.json({ stack: ids.map(id => tools.find(t => t.id === id)).filter(Boolean), updatedAt: row ? row.updated_at : null });
});

const radarServices = ['ChatGPT', 'Claude', 'DeepSeek', 'Midjourney'];
app.get('/api/radar', (req, res) => {
    res.json({ services: radarServices.map(name => {
        const roll = Math.random();
        const status = roll < 0.85 ? 'operational' : roll < 0.97 ? 'degraded' : 'down';
        return {
            name,
            status,
            latency: status === 'down' ? null : Math.round(80 + Math.random() * (status === 'degraded' ? 1200 : 500)),
            checkedAt: new Date().toISOString(),
        };
    }) });
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
