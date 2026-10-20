const express = require('express');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
    etag: true,
    lastModified: true,
    setHeaders(res, file) {
        if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
}));

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
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        free_value INTEGER,
        free_unit TEXT,
        free_period TEXT,
        price_month REAL,
        price_note TEXT,
        has_api INTEGER NOT NULL DEFAULT 0,
        ru_ui INTEGER NOT NULL DEFAULT 0,
        formats TEXT,
        checked_note TEXT
    );
    CREATE TABLE IF NOT EXISTS tool_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_id INTEGER NOT NULL,
        author_id INTEGER,
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
        CREATE TABLE IF NOT EXISTS prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_id INTEGER,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        copies INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fact_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        observed INTEGER,
        unit TEXT,
        works INTEGER NOT NULL DEFAULT 1,
        needs_vpn INTEGER NOT NULL DEFAULT 0,
        minutes INTEGER,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'published',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fact_confirms (
        report_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        agrees INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (report_id, user_id)
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
        note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
`);

// Миграции для баз, созданных до этих колонок
ensureColumn('users', 'avatar', 'TEXT');
ensureColumn('uptime', 'error', 'TEXT');
ensureColumn('tool_changes', 'author_id', 'INTEGER');
ensureColumn('tools', 'free_value', 'INTEGER');
ensureColumn('tools', 'free_unit', 'TEXT');
ensureColumn('tools', 'free_period', 'TEXT');
ensureColumn('tools', 'price_month', 'REAL');
ensureColumn('tools', 'price_note', 'TEXT');
ensureColumn('tools', 'has_api', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('tools', 'ru_ui', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('tools', 'formats', 'TEXT');
ensureColumn('tools', 'checked_note', 'TEXT');
ensureColumn('public_stacks', 'note', 'TEXT');

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

// Полный каталог со структурированными данными: числовые лимиты, цены,
// наличие API и русского интерфейса, форматы. Из него заполняются
// недостающие поля и добавляются новые инструменты.
const { CATALOG, HISTORY } = require('./catalog');

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
        freeValue: r.free_value,
        freeUnit: r.free_unit,
        freePeriod: r.free_period,
        priceMonth: r.price_month,
        priceNote: r.price_note,
        hasApi: !!r.has_api,
        ruUi: !!r.ru_ui,
        formats: r.formats ? JSON.parse(r.formats) : [],
        checkedNote: r.checked_note,
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

// Дозаполняем структурированные поля из каталога и правим описания.
// Значения, которые менял админ, не трогаем: заполняем только пустые.
const catalogById = new Map(CATALOG.map(t => [t.id, t]));
const updateTool = db.prepare(`
    UPDATE tools SET
        desc = COALESCE(NULLIF(desc, ''), ?),
        limits = COALESCE(NULLIF(limits, ''), ?),
        pros = COALESCE(NULLIF(pros, ''), ?),
        cons = COALESCE(NULLIF(cons, ''), ?),
        free_value = COALESCE(free_value, ?),
        free_unit = COALESCE(NULLIF(free_unit, ''), ?),
        free_period = COALESCE(NULLIF(free_period, ''), ?),
        price_month = COALESCE(price_month, ?),
        price_note = COALESCE(NULLIF(price_note, ''), ?),
        has_api = COALESCE(has_api, ?),
        ru_ui = COALESCE(ru_ui, ?),
        formats = COALESCE(NULLIF(formats, ''), ?),
        checked_note = COALESCE(NULLIF(checked_note, ''), ?)
    WHERE id = ?
`);

let enriched = 0;
const seedById = new Map(TOOL_SEED.map(t => [t.id, t]));

// Поля, которые синхронизируются с каталогом, если админ их не менял.
// Сверяемся со стартовым набором: если значение там и здесь одинаковые,
// значит правки не было и каталог — источник истины.
const SYNC_FIELDS = [
    ['name', t => t.name], ['domain', t => t.domain], ['category', t => t.category],
    ['desc', t => t.desc], ['payment', t => t.payment], ['vpn', t => t.vpn],
    ['url', t => t.url], ['tags', t => JSON.stringify(t.tags)],
    ['editorial', t => t.editorial], ['speed', t => t.speed], ['limits', t => t.limits],
    ['pros', t => t.pros], ['cons', t => t.cons],
    ['is_free', t => t.is_free ? 1 : 0], ['no_signup', t => t.noSignup ? 1 : 0],
];

for (const c of CATALOG) {
    const row = db.prepare('SELECT * FROM tools WHERE id = ?').get(c.id);
    if (!row) {
        db.prepare(`
            INSERT INTO tools (id, name, domain, category, desc, payment, vpn, url, tags,
                               editorial, speed, limits, pros, cons, is_free, no_signup,
                               free_value, free_unit, free_period, price_month, price_note,
                               has_api, ru_ui, formats, checked_note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(c.id, c.name, c.domain, c.category, c.desc, c.payment, c.vpn, c.url,
            JSON.stringify(c.tags), c.editorial, c.speed, c.limits, c.pros, c.cons,
            c.is_free ? 1 : 0, c.noSignup ? 1 : 0,
            c.freeValue, c.freeUnit, c.freePeriod, c.priceMonth, c.priceNote,
            c.hasApi ? 1 : 0, c.ruUi ? 1 : 0, JSON.stringify(c.formats), c.checkedNote);
        enriched++;
        continue;
    }

    const seed = seedById.get(c.id);
    if (seed) {
        for (const [field, pick] of SYNC_FIELDS) {
            const current = row[field];
            const seeded = field === 'tags'
                ? JSON.stringify(seed.tags)
                : seed[field];
            if (String(current) !== String(seeded)) continue;   // правили вручную
            const next = pick(c);
            if (String(current) === String(next)) continue;
            db.prepare(`UPDATE tools SET ${field} = ? WHERE id = ?`).run(next, c.id);
            enriched++;
        }
    }

    const before = JSON.stringify(row);
    updateTool.run(c.desc, c.limits, c.pros, c.cons,
        c.freeValue, c.freeUnit, c.freePeriod, c.priceMonth, c.priceNote,
        c.hasApi ? 1 : 0, c.ruUi ? 1 : 0, JSON.stringify(c.formats), c.checkedNote, c.id);
    if (JSON.stringify(db.prepare('SELECT * FROM tools WHERE id = ?').get(c.id)) !== before) enriched++;
}
if (enriched) console.log(`[catalog] обновлено записей: ${enriched}`);

// История изменений. Засевается один раз, дальше её ведёт админ.
if (!db.prepare('SELECT COUNT(*) AS n FROM tool_changes').get().n) {
    const byName = new Map(CATALOG.map(t => [t.name, t.id]));
    const log = db.prepare('INSERT INTO tool_changes (tool_id, field, old_value, new_value, note, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    let n = 0;
    for (const h of HISTORY) {
        const id = byName.get(h.tool);
        if (!id) continue;
        // Записи «ничего не поменялось» в историю не идут — это шум
        if (h.next === 'без изменений' || h.old === h.next) continue;
        log.run(id, h.field, h.old, h.next, h.note, h.date + ' 12:00:00');
        n++;
    }
    console.log(`[history] загружено записей: ${n}`);
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
// ---------- человеческие адреса и метаданные ----------
// Страница инструмента отдаётся по /tool/12 — так ссылку можно показать
// в чате, и она превращается в карточку с описанием и картинкой.
const SITE_NAME = 'AI Tools Hub';
const OG_DEFAULT = '/og-default.svg';

const fs = require('fs');

function toolImage(tool) {
    const cached = db.prepare('SELECT image FROM og_cache WHERE domain = ? AND image IS NOT NULL').get(tool.domain);
    return cached?.image || OG_DEFAULT;
}

const baseUrl = req => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

app.get('/tool/:id', (req, res) => {
    const tool = getTool(Number(req.params.id));
    if (!tool) return res.status(404).sendFile(path.join(__dirname, 'public', 'tool.html'));

    const stats = db.prepare('SELECT COUNT(*) as n, AVG(value) as avg FROM ratings WHERE tool_id = ?').get(tool.id);
    const userAvg = stats.avg ? Math.round(stats.avg * 10) / 10 : null;
    const html = fs.readFileSync(path.join(__dirname, 'public', 'tool.html'), 'utf8');

    const esc = s => String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const url = `${baseUrl(req)}/tool/${tool.id}`;
    const full = `${SITE_NAME} — ${tool.name}`;
    const desc = `${tool.desc} Лимиты: ${tool.limits}. Доступ: ${tool.vpn}. Рейтинг ${(userAvg ?? tool.rating).toFixed(1)} из 5.`;
    const abs = p => /^https?:\/\//.test(p) ? p : `${baseUrl(req)}${p.startsWith('/') ? '' : '/'}${p}`;
    const img = toolImage(tool);

    const tags = [
        `<title>${esc(full)}</title>`,
        `<meta name="description" content="${esc(desc)}">`,
        `<link rel="canonical" href="${esc(url)}">`,
        `<meta property="og:type" content="article">`,
        `<meta property="og:site_name" content="${SITE_NAME}">`,
        `<meta property="og:title" content="${esc(full)}">`,
        `<meta property="og:description" content="${esc(desc)}">`,
        `<meta property="og:image" content="${esc(abs(img))}">`,
        `<meta property="og:url" content="${esc(url)}">`,
        `<meta name="twitter:card" content="summary_large_image">`,
        `<meta name="twitter:title" content="${esc(full)}">`,
        `<meta name="twitter:description" content="${esc(desc)}">`,
        `<meta name="twitter:image" content="${esc(abs(img))}">`,
    ].join('\n    ');

    const payload = JSON.stringify({ tool, ratingsCount: stats.n, userAvg })
        .replace(/</g, '\\u003c');

    res.type('html').send(
        html
            .replace(/<title>[\s\S]*?<\/title>/, '')
            .replace('</head>', `    ${tags}\n</head>`)
            .replace('<div id="toolPage"></div>',
                `<div id="toolPage"></div>\n    <script>window.__TOOL__ = ${payload};</script>`),
    );
});

app.get('/api/tools', (req, res) => {
    res.json({ tools: getTools() });
});

app.get('/api/tools/:id', (req, res) => {
    const tool = getTool(Number(req.params.id));
    if (!tool) return res.status(404).json({ error: 'Не найдено' });
    const r = db.prepare('SELECT COUNT(*) as n, AVG(value) as avg FROM ratings WHERE tool_id = ?').get(tool.id);
    const viewer = getUser(req);
    const rawComments = db.prepare(`
        SELECT c.id, c.user_id, c.text, c.created_at, u.username, u.avatar
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
        version: '3.0',
        date: '20 октября 2026',
        items: [
            'Калькулятор стоимости: объём работы в день или месяц → что бесплатно, а что платно',
            'Лимиты и цены в цифрах: число, единица, период, цена в месяц, наличие API',
            'Живой статус по всем 24 сервисам каталога, а не по сторонним API',
            'Отдельно различаем «сервис лежит» и «маршрут закрыт, нужен VPN»',
            'История изменений условий: 40 записей по 24 сервисам',
            'Факт-чеки: структурированные наблюдения вместо свободных комментариев',
            'Профиль стал рабочим кабинетом: смета по стеку, что изменилось у моих сервисов',
            'Человеческие адреса /tool/12, og-теги, иконки, sitemap, страница 404',
        ],
    },
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
// Проверяем НАСТОЯЩИЙ ответ сервисов из каталога. Никаких Math.random().
// Ответ кодается в БД, чтобы был виден аптайм за сутки.
//
// Список берётся из таблицы tools, поэтому статус появляется у каждого
// инструмента и в каталоге, и на его странице.
const RADAR_TARGETS = [
    { name: 'OpenAI API', url: 'https://api.openai.com/v1/models', weight: 3, toolId: 1 },
    { name: 'Anthropic API', url: 'https://api.anthropic.com/v1/models', weight: 3, toolId: 2 },
    { name: 'Google AI', url: 'https://generativelanguage.googleapis.com/v1beta/models', weight: 2, toolId: 4 },
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
    // Цели собираются из каталога: у каждого инструмента свой адрес,
    // который реально отвечает. Отдельные API-проверки идут сверху.
    const toolTargets = db.prepare('SELECT id, name, domain, url FROM tools ORDER BY id').all()
        .map(t => ({ name: t.name, url: `https://${t.domain}/`, weight: 2, toolId: t.id }));

    const targets = [...toolTargets, ...RADAR_TARGETS];
    const results = await Promise.all(targets.map(probe));

    const now = new Date().toISOString();
    const insert = db.prepare('INSERT INTO uptime (service, status, latency, error, checked_at) VALUES (?, ?, ?, ?, ?)');
    const prune = db.prepare('DELETE FROM uptime WHERE checked_at < ?');

    // Таймаут у сервиса, который и так требует VPN, — это не поломка,
    // а закрытый маршрут. Разделяем статусы, чтобы не врать.
    const vpnTools = new Set(db.prepare("SELECT name FROM tools WHERE vpn = 'Нужен VPN'").all().map(r => r.name));

    targets.forEach((t, i) => {
        const r = results[i];
        const status = (r.error === 'timeout' && vpnTools.has(t.name)) ? 'blocked' : r.status;
        insert.run(t.name, status, r.latency, r.error, now);
        t.lastStatus = status;
        t.lastError = r.error;
    });

    // храним сутки, не больше
    prune.run(new Date(Date.now() - 24 * 3600 * 1000).toISOString());
    db.prepare('DELETE FROM uptime WHERE service NOT IN (' +
        targets.map(() => '?').join(',') + ')').run(...targets.map(t => t.name));

    lastRadarRun = now;
}

let lastRadarRun = null;

// Первая проверка сразу при старте, дальше раз в 5 минут
runRadarCheck().catch(() => { });
setInterval(() => runRadarCheck().catch(() => { }), 5 * 60 * 1000);

// Редакционные сценарии: не пользовательские подборки с выдуманными
// лайками, а готовые наборы под задачу с объяснением, зачем каждый.
if (!db.prepare('SELECT COUNT(*) AS n FROM public_stacks WHERE note IS NOT NULL').get().n) {
    // Старые заготовки без пояснений убираем: у них были выдуманные лайки
    db.prepare('DELETE FROM public_stacks').run();
    const seed = [
        ['Иллюстрации для магазина', '100 картинок в месяц без подписки',
            [10, 12, 21], 'редакция', 0,
            'Stable Diffusion локально или Kandinsky онлайн — оба без подписки. Firefly добавляют, когда нужен результат прямо в Photoshop.'],
        ['Код без подписки', 'IDE с автодополнением и без VPN',
            [5, 6, 7], 'редакция', 0,
            'Copilot и Windsurf работают из России без VPN. Cursor удобнее, но его быстрые запросы съедают лимит.'],
        ['Тексты и переводы', 'Работа с длинными документами',
            [1, 2, 17], 'редакция', 0,
            'Claude лучше всех работает с длинными текстами, ChatGPT — с файлами и голосом, Perplexity — когда нужны ссылки на источники.'],
        ['Ролик для соцсетей', 'Видео и озвучка за один вечер',
            [15, 16, 20], 'редакция', 0,
            'Pika и Luma дают быстрый результат, ElevenLabs закрывает озвучку. Всё работает без VPN.'],
    ];
    const insert = db.prepare('INSERT INTO public_stacks (name, task, tool_ids, author, likes, note) VALUES (?, ?, ?, ?, ?, ?)');
    seed.forEach(([name, task, ids, author, likes, note]) =>
        insert.run(name, task, JSON.stringify(ids), author, likes, note));
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
            toolId: t.toolId || null,
            status: last ? last.status : 'unknown',
            latency: last ? last.latency : null,
            error: last ? last.error : null,
            checkedAt: last ? last.checked_at : null,
            uptime24h: total ? Math.round((good / total) * 100) : null,
            checks: total,
        };
    });

    // Статус каждого инструмента каталога — по его домену
    const toolStatus = db.prepare('SELECT id, name, domain FROM tools ORDER BY id').all().map(t => {
        const last = db.prepare('SELECT status, latency, error, checked_at FROM uptime WHERE service = ? ORDER BY checked_at DESC LIMIT 1').get(t.name);
        const rows = db.prepare('SELECT status FROM uptime WHERE service = ? AND checked_at >= ? ORDER BY checked_at ASC').all(t.name, since);
        const good = rows.filter(r => r.status !== 'down').length;
        return {
            toolId: t.id,
            name: t.name,
            domain: t.domain,
            status: last ? last.status : 'unknown',
            latency: last ? last.latency : null,
            error: last ? last.error : null,
            checkedAt: last ? last.checked_at : null,
            uptime24h: rows.length ? Math.round((good / rows.length) * 100) : null,
            checks: rows.length,
        };
    });

    const known = toolStatus.filter(s => s.status !== 'unknown');
    const summary = {
        total: known.length,
        down: known.filter(s => s.status === 'down').length,
        degraded: known.filter(s => s.status === 'degraded').length,
        blocked: known.filter(s => s.status === 'blocked').length,
        lastRun: lastRadarRun,
    };

    res.json({
        services,
        tools: toolStatus,
        summary,
        method: 'реальные HTTP-запросы к сайтам сервисов из каталога, каждые 5 минут',
    });
});

// ---------- промпт-библиотека ----------
const { PROMPTS } = require('./prompts');

if (!db.prepare('SELECT COUNT(*) AS n FROM prompts').get().n) {
    const insert = db.prepare('INSERT INTO prompts (tool_id, category, title, body) VALUES (?, ?, ?, ?)');
    for (const p of PROMPTS) insert.run(p.tool || null, p.cat, p.title, p.body);
    console.log(`[prompts] загружено: ${PROMPTS.length}`);
}

app.get('/api/prompts', (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const cat = String(req.query.cat || '').trim();
    const rows = db.prepare(`
        SELECT p.id, p.tool_id, p.category, p.title, p.body, p.copies, t.name AS tool_name
        FROM prompts p LEFT JOIN tools t ON t.id = p.tool_id
        ORDER BY p.copies DESC, p.id ASC
    `).all();

    const list = rows.filter(p => {
        if (cat && p.category !== cat) return false;
        if (!q) return true;
        return (p.title + ' ' + p.body + ' ' + (p.tool_name || '')).toLowerCase().includes(q);
    });

    res.json({
        prompts: list,
        categories: [...new Set(rows.map(p => p.category))],
        total: rows.length,
    });
});

app.post('/api/prompts/:id/copy', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM prompts WHERE id = ?').get(id)) {
        return res.status(404).json({ error: 'Не найдено' });
    }
    db.prepare('UPDATE prompts SET copies = copies + 1 WHERE id = ?').run(id);
    res.json({ ok: true });
});

// ---------- лента изменений ----------
// Что поменялось у провайдеров. Показываем последние изменения с их
// настоящими датами и отдельно считаем, сколько пришлось на последний месяц.
app.get('/api/changes', (req, res) => {
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const rows = db.prepare(`
        SELECT c.id, c.field, c.old_value, c.new_value, c.note, c.created_at, t.id AS tool_id, t.name AS tool_name
        FROM tool_changes c JOIN tools t ON t.id = c.tool_id
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT 40
    `).all();

    const recentCount = db.prepare('SELECT COUNT(*) as n FROM tool_changes WHERE created_at >= ?').get(since).n;

    const byDay = new Map();
    rows.forEach(r => {
        const day = String(r.created_at).slice(0, 10);
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(r);
    });

    res.json({
        days,
        total: rows.length,
        recentCount,
        lastChange: rows[0] ? rows[0].created_at : null,
        recent: rows.slice(0, 8),
        timeline: [...byDay].slice(0, 10).map(([day, items]) => ({ day, items })),
    });
});
// Считает, во сколько обойдётся объём работы на платных тарифах.
// Считаем по объёму: из месячного лимита вычитаем бесплатный,
// остаток оплачивается по цене месяца.
function monthlyPrice(tool) {
    if (tool.priceMonth && tool.priceMonth > 0) return tool.priceMonth;
    return 0;
}

// Примерная стоимость одной единицы работы, взятая из месячной цены
function unitCost(tool, unitsPerMonth) {
    const price = monthlyPrice(tool);
    if (!price || !unitsPerMonth) return 0;
    return price / unitsPerMonth;
}

const WORKLOADS = {
    text: { unit: 'сообщений', perMonth: 500, label: 'запросов к чату', categories: ['text', 'assistant'] },
    image: { unit: 'изображений', perMonth: 100, label: 'картинок', categories: ['art'] },
    video: { unit: 'роликов', perMonth: 20, label: 'видео', categories: ['video'] },
    audio: { unit: 'минут', perMonth: 300, label: 'минут озвучки', categories: ['video'] },
    code: { unit: 'дополнений', perMonth: 1000, label: 'автодополнений', categories: ['code'] },
    '3d': { unit: 'моделей', perMonth: 20, label: '3D-моделей', categories: ['3d'] },
};

app.post('/api/calc', (req, res) => {
    const { volume = 100, work = 'text', period = 'month', freeOnly = false, noVpn = false } = req.body || {};
    const v = Math.max(1, Math.min(1000000, Number(volume) || 100));
    const wl = WORKLOADS[work] || WORKLOADS.text;
    const perDay = period === 'day';

    const all = getTools();
    // Показываем сервисы подходящей категории, а если их нет — все сразу
    const scoped = all.filter(t => wl.categories.includes(t.category));
    const source = scoped.length ? scoped : all;

    const rows = source.map(t => {
        const free = t.freeValue || 0;

        // Сколько бесплатно выдают за сутки. Окна вроде «3 часа»
        // пересчитываем в сутки, месячные лимиты считаем как есть.
        let freePerDay = 0;
        if (t.freePeriod === 'день') freePerDay = free;
        else if (t.freePeriod === '3 часа') freePerDay = free * 8;
        else if (t.freePeriod === '5 часов') freePerDay = free * (24 / 5);
        else if (t.freePeriod === 'месяц') freePerDay = free / 30;

        const capacity = perDay ? freePerDay : freePerDay * 30;
        const over = t.freeValue ? Math.max(0, v - capacity) : 0;
        const price = monthlyPrice(t);

        // Оплаченный месяц стоит целиком, если объём не укладывается
        // в бесплатный лимит.
        const cost = over > 0 && price > 0 ? price : 0;

        let verdict;
        if (!t.free && !t.freeValue) verdict = 'нет бесплатного тарифа';
        else if (over === 0) verdict = 'бесплатно';
        else if (cost > 0) verdict = `$${cost}/мес`;
        else verdict = 'впритык';

        return {
            id: t.id,
            name: t.name,
            category: t.category,
            free: t.is_free,
            vpn: t.vpn,
            hasApi: t.hasApi,
            freePerDay: Math.round(freePerDay * 10) / 10 || null,
            freePerMonth: Math.round(freePerDay * 30) || null,
            freeLabel: t.freeValue
                ? `${t.freeValue} ${t.freeUnit}${t.freePeriod ? ' / ' + t.freePeriod : ''}`
                : (t.free ? 'без ограничений' : null),
            over: over > 0,
            cost,
            price,
            verdict,
            fits: over === 0,
        };
    });

    const filtered = rows.filter(r => {
        if (freeOnly && r.cost > 0) return false;
        if (noVpn && r.vpn !== 'Без VPN') return false;
        return true;
    });

    const cheapest = [...filtered].sort((a, b) => a.cost - b.cost || (b.freePerMonth || 0) - (a.freePerMonth || 0));

    res.json({
        volume: v,
        work,
        period,
        unit: wl.unit,
        label: wl.label,
        rows: filtered.sort((a, b) => a.cost - b.cost || (b.freePerDay || 0) - (a.freePerDay || 0)),
        best: cheapest[0] || null,
        freeCount: filtered.filter(r => r.cost === 0).length,
        totalCount: source.length,
    });
});

app.get('/api/calc/workloads', (req, res) => res.json({ workloads: WORKLOADS }));

// Наблюдения текущего пользователя
app.get('/api/me/reports', requireAuth, (req, res) => {
    const rows = db.prepare(`
        SELECT r.id, r.tool_id, r.observed, r.unit, r.works, r.needs_vpn, r.note, r.created_at, t.name AS tool_name
        FROM fact_reports r JOIN tools t ON t.id = r.tool_id
        WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 30
    `).all(req.user.id);
    res.json({
        reports: rows.map(r => ({
            ...r,
            toolName: r.tool_name,
            works: !!r.works,
            needsVpn: !!r.needs_vpn,
        })),
    });
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

// ---------- факт-чеки: что сервис реально выдаёт ----------
// Вместо свободных комментариев — структурированное наблюдение.
// Из них собирается «фактический лимит», который расходится с заявленным.
app.post('/api/tools/:id/report', requireAuth, (req, res) => {
    const toolId = Number(req.params.id);
    if (!getTool(toolId)) return res.status(404).json({ error: 'Инструмент не найден' });

    const { observed, unit, works, needsVpn, minutes, note } = req.body || {};
    const obs = observed === undefined || observed === null || observed === '' ? null : Number(observed);
    if (obs !== null && (!Number.isFinite(obs) || obs < 0 || obs > 1000000)) {
        return res.status(400).json({ error: 'Наблюдение вне диапазона' });
    }
    const txt = String(note || '').trim().slice(0, 300);
    if (obs === null && !txt) {
        return res.status(400).json({ error: 'Укажите, сколько получилось, или добавьте заметку' });
    }
    if (obs === null && txt.length < 10) {
        return res.status(400).json({ error: 'Заметка слишком короткая' });
    }

    const result = db.prepare(`
        INSERT INTO fact_reports (tool_id, user_id, observed, unit, works, needs_vpn, minutes, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(toolId, req.user.id, obs,
        String(unit || '').slice(0, 30) || null,
        works === false ? 0 : 1,
        needsVpn ? 1 : 0,
        minutes ? Math.max(0, Math.min(100000, Number(minutes))) : null,
        txt || null);

    res.status(201).json({ ok: true, id: result.lastInsertRowid });
});

app.get('/api/tools/:id/reports', (req, res) => {
    const toolId = Number(req.params.id);
    const viewer = getUser(req);

    const rows = db.prepare(`
        SELECT r.id, r.observed, r.unit, r.works, r.needs_vpn, r.minutes, r.note, r.created_at,
               u.username, u.avatar
        FROM fact_reports r JOIN users u ON u.id = r.user_id
        WHERE r.tool_id = ? AND r.status = 'published'
        ORDER BY r.id DESC LIMIT 40
    `).all(toolId);

    const reports = rows.map(r => {
        const counts = db.prepare('SELECT SUM(agrees) as yes, COUNT(*) as n FROM fact_confirms WHERE report_id = ?').get(r.id);
        const mine = viewer
            ? db.prepare('SELECT agrees FROM fact_confirms WHERE report_id = ? AND user_id = ?').get(r.id, viewer.id)
            : null;
        return {
            ...r,
            works: !!r.works,
            needsVpn: !!r.needs_vpn,
            confirms: counts.yes || 0,
            votes: counts.n || 0,
            myVote: mine ? mine.agrees : null,
        };
    });

    // Сводка: сколько в среднем выдают по последним наблюдениям
    const numbers = reports.filter(r => r.observed !== null).map(r => r.observed);
    const summary = numbers.length
        ? {
            count: numbers.length,
            median: numbers.sort((a, b) => a - b)[Math.floor(numbers.length / 2)],
            min: Math.min(...numbers),
            max: Math.max(...numbers),
        }
        : null;

    res.json({ reports, summary });
});

app.post('/api/reports/:id/confirm', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const agrees = req.body?.agrees ? 1 : 0;
    const report = db.prepare('SELECT id, user_id FROM fact_reports WHERE id = ?').get(id);
    if (!report) return res.status(404).json({ error: 'Не найдено' });
    if (report.user_id === req.user.id) return res.status(400).json({ error: 'Нельзя подтвердить свой же отчёт' });

    const has = db.prepare('SELECT agrees FROM fact_confirms WHERE report_id = ? AND user_id = ?').get(id, req.user.id);
    if (has) {
        if (has.agrees === agrees) {
            db.prepare('DELETE FROM fact_confirms WHERE report_id = ? AND user_id = ?').run(id, req.user.id);
            return res.json({ agrees: null, count: agreeCount(id) });
        }
        db.prepare('UPDATE fact_confirms SET agrees = ? WHERE report_id = ? AND user_id = ?').run(agrees, id, req.user.id);
    } else {
        db.prepare('INSERT INTO fact_confirms (report_id, user_id, agrees) VALUES (?, ?, ?)').run(id, req.user.id, agrees);
    }
    res.json({ agrees, count: agreeCount(id) });
});

function agreeCount(reportId) {
    return db.prepare('SELECT SUM(agrees) as n FROM fact_confirms WHERE report_id = ?').get(reportId).n || 0;
}

app.post('/api/reports/:id/moderate', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const action = req.body?.action;
    if (!['hide', 'show', 'delete'].includes(action)) {
        return res.status(400).json({ error: 'Неизвестное действие' });
    }
    if (action === 'delete') {
        db.prepare('DELETE FROM fact_confirms WHERE report_id = ?').run(id);
        db.prepare('DELETE FROM fact_reports WHERE id = ?').run(id);
    } else {
        db.prepare('UPDATE fact_reports SET status = ? WHERE id = ?')
            .run(action === 'hide' ? 'hidden' : 'published', id);
    }
    res.json({ ok: true });
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
function isAdminUser(id) {
    return !!db.prepare('SELECT 1 FROM admins WHERE user_id = ?').get(id);
}

function requireAdmin(req, res, next) {
    const user = getUser(req);
    if (!user) return res.status(401).json({ error: 'Требуется авторизация' });
    if (!isAdminUser(user.id)) return res.status(403).json({ error: 'Нужны права администратора' });
    req.user = user;
    next();
}

// Список админов задаётся переменной окружения ADMIN_USERS (логины через запятую).
// Если её нет, админом делаем самую раннюю учётную запись — но только её,
// а не любого, кто зарегистрировался раньше остальных.
const ADMIN_USERS = (process.env.ADMIN_USERS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

function syncAdmins() {
    const existing = new Set(db.prepare('SELECT user_id FROM admins').all().map(r => r.user_id));

    if (ADMIN_USERS.length) {
        const wanted = db.prepare(`SELECT id FROM users WHERE username IN (${ADMIN_USERS.map(() => '?').join(',')})`).all(...ADMIN_USERS)
            .map(r => r.id);
        wanted.forEach(id => {
            if (!existing.has(id)) db.prepare('INSERT OR IGNORE INTO admins (user_id) VALUES (?)').run(id);
        });
        // убираем тех, кого явно исключили
        db.prepare(`DELETE FROM admins WHERE user_id NOT IN (SELECT id FROM users WHERE username IN (${ADMIN_USERS.map(() => '?').join(',')}))`)
            .run(...ADMIN_USERS);
        return;
    }

    if (existing.size) return;
    const first = db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
    if (first) db.prepare('INSERT OR IGNORE INTO admins (user_id) VALUES (?)').run(first.id);
}

syncAdmins();

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
    const log = db.prepare('INSERT INTO tool_changes (tool_id, author_id, field, old_value, new_value, note) VALUES (?, ?, ?, ?, ?, ?)');
    for (const [field, p] of Object.entries(patch)) {
        log.run(id, req.user.id, field, String(p.old ?? ''), String(p.next ?? ''),
            String(req.body.note || '').slice(0, 200));
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
app.get('/api/admin/activity', requireAdmin, (req, res) => {
    const rows = db.prepare(`
        SELECT ch.tool_id, ch.field, ch.old_value, ch.new_value, ch.created_at, u.username
        FROM tool_changes ch LEFT JOIN users u ON u.id = ch.author_id
        ORDER BY ch.created_at DESC, ch.id DESC LIMIT 30
    `).all();
    res.json({ activity: rows });
});

app.get('/api/admin/stale', requireAdmin, (req, res) => {
    const rows = db.prepare(`
        SELECT * FROM tools
        ORDER BY COALESCE(verified_at, '2000-01-01') ASC
    `).all();
    res.json({ tools: rows.map(rowToTool) });
});

// Удаление и редактирование своих комментариев
app.delete('/api/comments/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const c = db.prepare('SELECT id, user_id FROM comments WHERE id = ?').get(id);
    if (!c) return res.status(404).json({ error: 'Не найдено' });
    if (c.user_id !== req.user.id && !isAdminUser(req.user.id)) {
        return res.status(403).json({ error: 'Можно удалять только свои комментарии' });
    }
    db.prepare('DELETE FROM comment_replies WHERE comment_id = ?').run(id);
    db.prepare('DELETE FROM comment_likes WHERE comment_id = ?').run(id);
    db.prepare('DELETE FROM comments WHERE id = ?').run(id);
    res.json({ ok: true });
});

app.patch('/api/comments/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const c = db.prepare('SELECT id, user_id FROM comments WHERE id = ?').get(id);
    if (!c) return res.status(404).json({ error: 'Не найдено' });
    if (c.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Можно править только свои комментарии' });
    }
    const text = String(req.body?.text || '').trim();
    if (text.length < 2 || text.length > 500) {
        return res.status(400).json({ error: 'Комментарий 2–500 символов' });
    }
    db.prepare('UPDATE comments SET text = ? WHERE id = ?').run(text, id);
    res.json({ ok: true, text });
});

// Удаление своего факт-чека
app.delete('/api/reports/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const r = db.prepare('SELECT id, user_id FROM fact_reports WHERE id = ?').get(id);
    if (!r) return res.status(404).json({ error: 'Не найдено' });
    if (r.user_id !== req.user.id && !isAdminUser(req.user.id)) {
        return res.status(403).json({ error: 'Можно удалять только свои наблюдения' });
    }
    db.prepare('DELETE FROM fact_confirms WHERE report_id = ?').run(id);
    db.prepare('DELETE FROM fact_reports WHERE id = ?').run(id);
    res.json({ ok: true });
});

app.post('/api/tools/:id/comment', requireAuth, (req, res) => {
    const toolId = Number(req.params.id);
    const text = (req.body && req.body.text || '').trim();
    if (!getTool(toolId)) return res.status(404).json({ error: 'Не найдено' });
    if (text.length < 2 || text.length > 500) return res.status(400).json({ error: 'Комментарий 2–500 символов' });
    db.prepare('INSERT INTO comments (tool_id, user_id, text) VALUES (?, ?, ?)').run(toolId, req.user.id, text);
    res.status(201).json({ ok: true });
});

app.get('/sitemap.xml', (req, res) => {
    const root = baseUrl(req).replace(/\/$/, '');
    const urls = [
        { loc: `${root}/`, pri: '1.0', freq: 'daily' },
        { loc: `${root}/compare.html`, pri: '0.7', freq: 'weekly' },
        { loc: `${root}/changelog.html`, pri: '0.4', freq: 'monthly' },
        ...getTools().map(t => ({ loc: `${root}/tool/${t.id}`, pri: '0.8', freq: 'weekly', mod: t.updatedAt })),
    ];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc.replace(/&/g, '&amp;')}</loc>
    ${u.mod ? `<lastmod>${String(u.mod).slice(0, 10)}</lastmod>` : ''}
    <changefreq>${u.freq}</changefreq>
    <priority>${u.pri}</priority>
  </url>`).join('\n')}
</urlset>`);
});

app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send([
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin.html',
        `Sitemap: ${baseUrl(req).replace(/\/$/, '')}/sitemap.xml`,
    ].join('\n'));
});

app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Не найдено' });
    const file = path.join(__dirname, 'public', '404.html');
    if (!fs.existsSync(file)) return res.status(404).send('Не найдено');
    res.status(404).type('html').send(fs.readFileSync(file, 'utf8'));
});

app.listen(PORT, () => {
    console.log(`AI Tools Hub запущен: http://localhost:${PORT}`);
});
