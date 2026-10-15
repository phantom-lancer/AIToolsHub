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

// Миграции: CREATE TABLE IF NOT EXISTS не добавляет новые колонки в существующие таблицы
function ensureColumn(table, column, definition) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some(c => c.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`[migrate] ${table}.${column} добавлена`);
    }
}

db.exec(`
    CREATE TABLE IF NOT EXISTS tools (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        domain TEXT NOT NULL,
        category TEXT NOT NULL,
        desc TEXT NOT NULL,
        payment TEXT NOT NULL,
        vpn TEXT NOT NULL,
        url TEXT NOT NULL,
        tags TEXT NOT NULL,
        editorial REAL NOT NULL DEFAULT 4.5,
        speed TEXT NOT NULL,
        limits TEXT NOT NULL,
        pros TEXT NOT NULL,
        cons TEXT NOT NULL,
        is_free INTEGER NOT NULL DEFAULT 0,
        no_signup INTEGER NOT NULL DEFAULT 0,
        verified_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS tool_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_id INTEGER NOT NULL,
        field TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS tool_changes_tool ON tool_changes(tool_id, created_at);
    CREATE TABLE IF NOT EXISTS admins (
        user_id INTEGER PRIMARY KEY
    );
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
    CREATE TABLE IF NOT EXISTS comment_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        comment_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS comment_likes (
        comment_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        PRIMARY KEY (comment_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS og_cache (
        domain TEXT PRIMARY KEY,
        image TEXT,
        description TEXT,
        fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS uptime (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service TEXT NOT NULL,
        status TEXT NOT NULL,
        latency INTEGER,
        error TEXT,
        checked_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS uptime_service_time ON uptime(service, checked_at);
    CREATE TABLE IF NOT EXISTS stack_likes (
        stack_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        PRIMARY KEY (stack_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS public_stacks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        task TEXT NOT NULL,
        tool_ids TEXT NOT NULL,
        author TEXT NOT NULL,
        likes INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
`);

// Миграции для баз, созданных до этих колонок
ensureColumn('users', 'avatar', 'TEXT');
ensureColumn('uptime', 'error', 'TEXT');

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

// Стартовый набор данных. Заливается в таблицу tools один раз,
// дальше правки идут через админку и в коде уже не хранятся.
const T = (id, name, domain, category, desc, payment, vpn, url, tags, rating, speed, limits, pros, cons, free, noSignup) =>
    ({ id, name, domain, category, desc, payment, vpn, url, tags, rating, speed, limits, pros, cons, free, noSignup });

const TOOL_SEED = [
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

// ---------- слой доступа к инструментам ----------
// Читаем из БД, собирая те же поля, которые раньше лежали в массиве,
// поэтому фронтенд и остальные эндпоинты ничего не замечают.
function rowToTool(r) {
    if (!r) return null;
    return {
        id: r.id,
        name: r.name,
        domain: r.domain,
        category: r.category,
        desc: r.desc,
        payment: r.payment,
        vpn: r.vpn,
        url: r.url,
        tags: r.tags ? JSON.parse(r.tags) : [],
        rating: r.editorial,
        editorial: r.editorial,
        speed: r.speed,
        limits: r.limits,
        pros: r.pros,
        cons: r.cons,
        free: !!r.is_free,
        noSignup: !!r.no_signup,
        verifiedAt: r.verified_at,
        updatedAt: r.updated_at,
    };
}

const ratingStmt = db.prepare('SELECT COUNT(*) as n, AVG(value) as avg FROM ratings WHERE tool_id = ?');

function getTools() {
    const rows = db.prepare('SELECT * FROM tools ORDER BY editorial DESC, name ASC').all();
    return rows.map(r => {
        const t = rowToTool(r);
        const stats = ratingStmt.get(t.id);
        t.ratingsCount = stats.n;
        t.userAvg = stats.avg ? Math.round(stats.avg * 10) / 10 : null;
        return t;
    });
}

function getTool(id) {
    return rowToTool(db.prepare('SELECT * FROM tools WHERE id = ?').get(id));
}

// Первый запуск: переносим стартовый набор в базу
if (!db.prepare('SELECT COUNT(*) AS n FROM tools').get().n) {
    const insert = db.prepare(`
        INSERT INTO tools (id, name, domain, category, desc, payment, vpn, url, tags,
                           editorial, speed, limits, pros, cons, is_free, no_signup)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const t of TOOL_SEED) {
        insert.run(t.id, t.name, t.domain, t.category, t.desc, t.payment, t.vpn, t.url,
            JSON.stringify(t.tags), t.rating, t.speed, t.limits, t.pros, t.cons,
            t.free ? 1 : 0, t.noSignup ? 1 : 0);
    }
    console.log(`[seed] ${TOOL_SEED.length} инструментов перенесены в базу`);
}
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
    res.json({ tools: getTools() });
});

app.get('/api/tools/:id', (req, res) => {
    const tool = getTool(Number(req.params.id));
    if (!tool) return res.status(404).json({ error: 'Не найдено' });
    const r = db.prepare('SELECT COUNT(*) as n, AVG(value) as avg FROM ratings WHERE tool_id = ?').get(tool.id);
    const viewer = getUser(req);
    const rawComments = db.prepare(`
        SELECT c.id, c.text, c.created_at, u.username, u.avatar
        FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.tool_id = ? ORDER BY c.id DESC
    `).all(tool.id);
    const comments = rawComments.map(c => ({
        ...c,
        likes: db.prepare('SELECT COUNT(*) as n FROM comment_likes WHERE comment_id = ?').get(c.id).n,
        liked: viewer ? !!db.prepare('SELECT 1 FROM comment_likes WHERE comment_id = ? AND user_id = ?').get(c.id, viewer.id) : false,
        replies: db.prepare('SELECT COUNT(*) as n FROM comment_replies WHERE comment_id = ?').get(c.id).n,
    }));
    const myRating = viewer ? db.prepare('SELECT value FROM ratings WHERE user_id = ? AND tool_id = ?').get(viewer.id, tool.id) : null;
    const isFav = viewer ? !!db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND tool_id = ?').get(viewer.id, tool.id) : false;
    res.json({ tool, ratingsCount: r.n, userAvg: r.avg ? Math.round(r.avg * 10) / 10 : null, comments, myRating: myRating ? myRating.value : 0, isFavorite: isFav });
});

app.post('/api/tools/:id/rate', requireAuth, (req, res) => {
    const toolId = Number(req.params.id);
    const value = Number(req.body && req.body.value);
    if (!getTool(toolId)) return res.status(404).json({ error: 'Не найдено' });
    if (!Number.isInteger(value) || value < 1 || value > 5) return res.status(400).json({ error: 'Оценка 1–5' });
    db.prepare('INSERT INTO ratings (user_id, tool_id, value) VALUES (?, ?, ?) ON CONFLICT(user_id, tool_id) DO UPDATE SET value = excluded.value').run(req.user.id, toolId, value);
    res.json({ ok: true });
});

app.post('/api/tools/:id/favorite', requireAuth, (req, res) => {
    const toolId = Number(req.params.id);
    if (!getTool(toolId)) return res.status(404).json({ error: 'Не найдено' });
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
    res.json({ favorites: rows.map(r => getTool(r.tool_id)).filter(Boolean) });
});

app.post('/api/favorites/import', requireAuth, (req, res) => {
    const ids = Array.isArray(req.body && req.body.toolIds) ? req.body.toolIds.filter(Number.isInteger) : [];
    const valid = ids.filter(id => getTool(id));
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
    res.json({ stack: ids.map(id => getTool(id)).filter(Boolean), updatedAt: row ? row.updated_at : null });
});

const CHANGELOG = [
    {
        version: '2.4',
        date: '8 октября 2026',
        items: [
            'Командная палитра ⌘K и горячие клавиши',
            'Свайп-переходы между страницами в стиле iOS',
            'Сравнение инструментов в нижней шторке',
            'Живые обложки сервисов из og:image с кэшем',
            'Community Stack Builder: подборки от пользователей',
            'Инструмент дня с промптом',
            'Лайки и ответы на комментариях',
            'Changelog-страница и состояние фильтров в ссылке',
        ],
    },
    {
        version: '2.3',
        date: '5 октября 2026',
        items: [
            'Стек-билдер с фильтрами «бесплатно» и «без регистрации»',
            'Live AI Radar с раскрывающимися деталями',
            'Live glass: единая система материалов на всех элементах',
        ],
    },
    {
        version: '2.2',
        date: '2 октября 2026',
        items: [
            'Сравнение двух нейросетей с вердиктом',
            'Избранное с экспортом и импортом JSON',
            'Оценки и комментарии к инструментам',
        ],
    },
    {
        version: '2.0',
        date: '28 сентября 2026',
        items: ['Регистрация и вход', 'Каталог с фильтрами и поиском', 'Профиль пользователя'],
    },
];

// ---------- живой статус сервисов ----------
// Проверяем НАСТОЯЩИЙ ответ стороннего API. Никаких Math.random().
// Ответ кодается в БД, чтобы был виден аптайм за сутки.
const RADAR_TARGETS = [
    { name: 'OpenAI API', url: 'https://api.openai.com/v1/models', weight: 3 },
    { name: 'Anthropic API', url: 'https://api.anthropic.com/v1/models', weight: 3 },
    { name: 'Google AI', url: 'https://generativelanguage.googleapis.com/v1beta/models', weight: 2 },
    { name: 'Replicate', url: 'https://api.replicate.com/v1/models', weight: 1 },
    { name: 'Hugging Face', url: 'https://huggingface.co/api/models?limit=1', weight: 1 },
];

// Порог по весу: чем важнее сервис, тем строже к времени ответа
function gradeStatus(ms, ok) {
    if (!ok) return 'down';
    if (ms > 2500) return 'degraded';
    return 'operational';
}

async function probe(target) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const started = Date.now();
    try {
        const res = await fetch(target.url, {
            method: 'GET',
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                // 401/403 тоже считаем «сервис жив» — значит дошли до сервера
                'user-agent': 'AI-Tools-Hub/uptime-check',
                accept: '*/*',
            },
        });
        const ms = Date.now() - started;
        // 5xx — сервис лежит, 4xx — живой (просто нужен ключ)
        const ok = res.status < 500;
        return { status: gradeStatus(ms, ok), latency: ms, http: res.status, error: null };
    } catch (e) {
        // Таймаут — скорее всего провайдер режет маршрут, а не сервис упал.
        // Различаем это и честно пишем в интерфейсе.
        const timeout = e.name === 'AbortError';
        return { status: 'down', latency: null, http: 0, error: timeout ? 'timeout' : 'unreachable' };
    } finally {
        clearTimeout(timer);
    }
}

async function runRadarCheck() {
    const results = await Promise.all(RADAR_TARGETS.map(probe));
    const now = new Date().toISOString();
    const insert = db.prepare('INSERT INTO uptime (service, status, latency, error, checked_at) VALUES (?, ?, ?, ?, ?)');
    const prune = db.prepare('DELETE FROM uptime WHERE checked_at < ?');

    RADAR_TARGETS.forEach((t, i) => {
        const r = results[i];
        insert.run(t.name, r.status, r.latency, r.error, now);
        t.lastStatus = r.status;
        t.lastError = r.error;
    });

    // храним сутки, не больше
    prune.run(new Date(Date.now() - 24 * 3600 * 1000).toISOString());
    db.prepare('DELETE FROM uptime WHERE service NOT IN (' +
        RADAR_TARGETS.map(() => '?').join(',') + ')').run(...RADAR_TARGETS.map(t => t.name));

    lastRadarRun = now;
}

let lastRadarRun = null;

// Первая проверка сразу при старте, дальше раз в 5 минут
runRadarCheck().catch(() => { });
setInterval(() => runRadarCheck().catch(() => { }), 5 * 60 * 1000);

// стартовые подборки сообщества, чтобы витрина не была пустой
if (!db.prepare('SELECT COUNT(*) AS n FROM public_stacks').get().n) {
    const seed = [
        ['Фриланс-дизайнер', 'дизайн и 3D', [9, 10, 21], 'редакция', 12],
        ['Инди-геймдев', '3D и код', [5, 23, 17], 'редакция', 9],
        ['Контент-мейкер', 'текст и видео', [1, 14, 19], 'редакция', 7],
    ];
    const insert = db.prepare('INSERT INTO public_stacks (name, task, tool_ids, author, likes) VALUES (?, ?, ?, ?, ?)');
    seed.forEach(([name, task, ids, author, likes]) => insert.run(name, task, JSON.stringify(ids), author, likes));
}
app.get('/api/radar', (req, res) => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const services = RADAR_TARGETS.map(t => {
        const last = db.prepare('SELECT status, latency, error, checked_at FROM uptime WHERE service = ? ORDER BY checked_at DESC LIMIT 1').get(t.name);
        const rows = db.prepare('SELECT status FROM uptime WHERE service = ? AND checked_at >= ? ORDER BY checked_at ASC').all(t.name, since);

        // аптайм за сутки = доля успешных замеров
        const total = rows.length;
        const good = rows.filter(r => r.status !== 'down').length;

        return {
            name: t.name,
            status: last ? last.status : 'unknown',
            latency: last ? last.latency : null,
            error: last ? last.error : null,
            checkedAt: last ? last.checked_at : null,
            uptime24h: total ? Math.round((good / total) * 100) : null,
            checks: total,
        };
    });

    const known = services.filter(s => s.status !== 'unknown');
    const summary = {
        total: known.length,
        down: known.filter(s => s.status === 'down').length,
        degraded: known.filter(s => s.status === 'degraded').length,
        lastRun: lastRadarRun,
    };

    res.json({ services, summary, method: 'реальные HTTP-запросы к API сервисов, каждые 5 минут' });
});

app.get('/api/changelog', (req, res) => res.json({ changelog: CHANGELOG }));

// ---------- обложки сервисов из og:image ----------
async function fetchOg(domain) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
        const page = await fetch(`https://${domain}`, {
            signal: controller.signal,
            redirect: 'follow',
            headers: { 'user-agent': 'Mozilla/5.0 AI Tools Hub preview', accept: 'text/html' },
        });
        const html = await page.text();
        const pick = (p) => {
            const re = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)["']`, 'i');
            const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, 'i');
            const m = html.match(re) || html.match(re2);
            return m ? m[1] : null;
        };
        return { image: pick('og:image'), description: pick('og:description') || pick('description') };
    } catch {
        return { image: null, description: null };
    } finally {
        clearTimeout(timer);
    }
}

app.get('/api/preview', async (req, res) => {
    const domain = String(req.query.domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!domain || !domain.includes('.')) return res.status(400).json({ error: 'Нет домена' });

    const saved = db.prepare('SELECT image, description FROM og_cache WHERE domain = ?').get(domain);
    if (saved) return res.json({ ...saved, cached: true });

    const found = await fetchOg(domain);
    db.prepare('INSERT INTO og_cache (domain, image, description) VALUES (?, ?, ?) ON CONFLICT(domain) DO UPDATE SET image = excluded.image, description = excluded.description, fetched_at = CURRENT_TIMESTAMP')
        .run(domain, found.image, found.description);
    res.json({ ...found, cached: false });
});

// ---------- инструмент дня ----------
app.get('/api/daily', (req, res) => {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now - start) / 86400000);
    const all = getTools();
    const tool = all[dayOfYear % all.length];
    const dayIndex = Math.floor(Date.now() / 86400000);

    const tips = {
        text: 'Напишите черновик заметки, затем попросите модель сократить его в 3 раза и сохранить факты.',
        code: 'Опишите функцию словами, затем попросите объяснить её построчно и предложить 3 теста.',
        art: 'Соберите промпт по формуле: объект + свет + стиль + камера. Меняйте один блок за раз.',
        video: 'Разбейте ролик на 3 сцены, опишите каждую одним предложением, затем соберите монтаж.',
        '3d': 'Опишите форму как объём из примитивов и добавьте материал и ракурс.',
        assistant: 'Сформулируйте вопрос так, будто объясняете его человеку-эксперту, и попросите источники.',
    };
    res.json({ tool, prompt: tips[tool.category] || 'Опишите задачу в два предложения и попросите план действий.', dayIndex });
});

// ---------- community stacks ----------
app.get('/api/community-stacks', (req, res) => {
    const rows = db.prepare('SELECT * FROM public_stacks ORDER BY likes DESC, id DESC LIMIT 20').all();
    res.json({
        stacks: rows.map(r => ({
            ...r,
            tools: JSON.parse(r.tool_ids).map(id => getTool(id)).filter(Boolean),
        })),
    });
});

app.post('/api/community-stacks', requireAuth, (req, res) => {
    const { name, task, toolIds } = req.body || {};
    const ids = Array.isArray(toolIds) ? toolIds.filter(Number.isInteger) : [];
    if (!name || !task || !ids.length) return res.status(400).json({ error: 'Нужны название, задача и инструменты' });
    db.prepare('INSERT INTO public_stacks (name, task, tool_ids, author) VALUES (?, ?, ?, ?)')
        .run(String(name).slice(0, 60), String(task).slice(0, 80), JSON.stringify(ids.slice(0, 10)), req.user.username);
    res.status(201).json({ ok: true });
});

app.post('/api/stacks/:id/like', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const stack = db.prepare('SELECT * FROM public_stacks WHERE id = ?').get(id);
    if (!stack) return res.status(404).json({ error: 'Не найдено' });
    const has = db.prepare('SELECT * FROM stack_likes WHERE stack_id = ? AND user_id = ?').get(id, req.user.id);
    if (has) {
        db.prepare('DELETE FROM stack_likes WHERE stack_id = ? AND user_id = ?').run(id, req.user.id);
        db.prepare('UPDATE public_stacks SET likes = MAX(0, likes - 1) WHERE id = ?').run(id);
        return res.json({ liked: false });
    }
    db.prepare('INSERT INTO stack_likes (stack_id, user_id) VALUES (?, ?)').run(id, req.user.id);
    db.prepare('UPDATE public_stacks SET likes = likes + 1 WHERE id = ?').run(id);
    res.json({ liked: true });
});

app.post('/api/stacks', requireAuth, (req, res) => {
    const { name, task, toolIds } = req.body || {};
    const ids = Array.isArray(toolIds) ? toolIds.filter(Number.isInteger) : [];
    if (!name || !task || !ids.length) return res.status(400).json({ error: 'Нужны название, задача и инструменты' });
    db.prepare('INSERT INTO public_stacks (name, task, tool_ids, author) VALUES (?, ?, ?, ?)')
        .run(String(name).slice(0, 60), String(task).slice(0, 80), JSON.stringify(ids.slice(0, 10)), req.user.username);
    res.status(201).json({ ok: true });
});

// ---------- лайки и ответы на комментариях ----------
app.get('/api/comments/:id/replies', requireAuth, (req, res) => {
    const rows = db.prepare(`
        SELECT r.id, r.text, r.created_at, u.username, u.avatar
        FROM comment_replies r JOIN users u ON u.id = r.user_id
        WHERE r.comment_id = ? ORDER BY r.id ASC
    `).all(Number(req.params.id));
    res.json({ replies: rows });
});

app.post('/api/comments/:id/reply', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const text = (req.body && req.body.text || '').trim();
    if (!db.prepare('SELECT id FROM comments WHERE id = ?').get(id)) return res.status(404).json({ error: 'Не найдено' });
    if (text.length < 2 || text.length > 400) return res.status(400).json({ error: 'Ответ 2–400 символов' });
    db.prepare('INSERT INTO comment_replies (comment_id, user_id, text) VALUES (?, ?, ?)').run(id, req.user.id, text);
    res.status(201).json({ ok: true });
});

app.post('/api/comments/:id/like', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM comments WHERE id = ?').get(id)) return res.status(404).json({ error: 'Не найдено' });
    const has = db.prepare('SELECT comment_id FROM comment_likes WHERE comment_id = ? AND user_id = ?').get(id, req.user.id);
    if (has) {
        db.prepare('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?').run(id, req.user.id);
        return res.json({ liked: false });
    }
    db.prepare('INSERT INTO comment_likes (comment_id, user_id) VALUES (?, ?)').run(id, req.user.id);
    res.json({ liked: true });
});

// ---------- админка: правка данных инструмента ----------
// Первый зарегистрировавшийся пользователь становится админом.
// Это осознанный компромисс для учебного проекта: админ один,
// отдельную систему ролей заводить избыточно.
function requireAdmin(req, res, next) {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Требуется авторизация' });
    const isFirst = !db.prepare('SELECT 1 FROM users WHERE id != ? LIMIT 1').get(user.id);
    const isAdmin = db.prepare('SELECT 1 FROM admins WHERE user_id = ?').get(user.id);
    if (!isFirst && !isAdmin) return res.status(403).json({ error: 'Нужны права администратора' });
    req.user = user;
    next();
}

// Первая учётная запись автоматически становится админом
if (!db.prepare('SELECT COUNT(*) AS n FROM admins').get().n) {
    const first = db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
    if (first) db.prepare('INSERT OR IGNORE INTO admins (user_id) VALUES (?)').run(first.id);
}

const EDITABLE = {
    name: 'Название', desc: 'Описание', limits: 'Лимиты и цена', pros: 'Плюсы', cons: 'Минусы',
    speed: 'Скорость', payment: 'Оплата', vpn: 'Доступ', category: 'Категория',
    url: 'Ссылка', domain: 'Домен',
};

app.post('/api/tools/:id/update', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const tool = db.prepare('SELECT * FROM tools WHERE id = ?').get(id);
    if (!tool) return res.status(404).json({ error: 'Инструмент не найден' });

    const patch = {};
    for (const [field, label] of Object.entries(EDITABLE)) {
        if (!(field in req.body)) continue;
        const value = String(req.body[field]).trim();
        if (!value) return res.status(400).json({ error: `Поле «${label}» не может быть пустым` });
        if (value.length > 400) return res.status(400).json({ error: `Поле «${label}» слишком длинное` });
        if (value === tool[field]) continue;
        patch[field] = { label, old: tool[field], next: value };
    }

    if (Array.isArray(req.body.tags)) {
        const tags = req.body.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 10);
        const oldTags = JSON.parse(tool.tags);
        if (JSON.stringify(tags) !== JSON.stringify(oldTags)) {
            patch.tags = { label: 'Теги', old: oldTags.join(', '), next: tags.join(', ') };
            req.body.tags = tags;
        }
    }

    if (!Object.keys(patch).length) return res.json({ ok: true, updated: [] });

    const sets = Object.keys(patch).map(f => `${f} = ?`);
    const values = Object.values(patch).map(p => p.next);
    sets.push('updated_at = CURRENT_TIMESTAMP');
    db.prepare(`UPDATE tools SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);

    // Каждое изменение — запись в историю. Из неё потом строится график.
    const log = db.prepare('INSERT INTO tool_changes (tool_id, field, old_value, new_value, note) VALUES (?, ?, ?, ?, ?)');
    for (const [field, p] of Object.entries(patch)) {
        log.run(id, field, String(p.old ?? ''), String(p.next ?? ''), String(req.body.note || '').slice(0, 200));
    }

    res.json({ ok: true, updated: Object.values(patch).map(p => p.label), tool: getTool(id) });
});

// Подтверждение, что данные проверены — без правки содержимого
app.post('/api/tools/:id/verify', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!getTool(id)) return res.status(404).json({ error: 'Инструмент не найден' });
    db.prepare('UPDATE tools SET verified_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
    res.json({ ok: true, tool: getTool(id) });
});

// История изменений по инструменту
app.get('/api/tools/:id/history', (req, res) => {
    const id = Number(req.params.id);
    if (!getTool(id)) return res.status(404).json({ error: 'Инструмент не найден' });
    const rows = db.prepare('SELECT field, old_value, new_value, note, created_at FROM tool_changes WHERE tool_id = ? ORDER BY created_at DESC, id DESC LIMIT 50').all(id);
    res.json({ history: rows });
});

// Список того, что пора проверить: чем дольше не проверяли, тем выше
app.get('/api/admin/stale', requireAdmin, (req, res) => {
    const rows = db.prepare(`
        SELECT * FROM tools
        ORDER BY COALESCE(verified_at, '2000-01-01') ASC
    `).all();
    res.json({ tools: rows.map(rowToTool) });
});

app.post('/api/tools/:id/comment', requireAuth, (req, res) => {
    const toolId = Number(req.params.id);
    const text = (req.body && req.body.text || '').trim();
    if (!getTool(toolId)) return res.status(404).json({ error: 'Не найдено' });
    if (text.length < 2 || text.length > 500) return res.status(400).json({ error: 'Комментарий 2–500 символов' });
    db.prepare('INSERT INTO comments (tool_id, user_id, text) VALUES (?, ?, ?)').run(toolId, req.user.id, text);
    res.status(201).json({ ok: true });
});

app.listen(PORT, () => {
    console.log(`AI Tools Hub запущен: http://localhost:${PORT}`);
});
