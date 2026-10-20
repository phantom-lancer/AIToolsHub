const grid = document.getElementById('grid');
const searchInput = document.getElementById('searchInput');
const filtersWrap = document.getElementById('filters');
const emptyMsg = document.getElementById('emptyMsg');
const authArea = document.getElementById('authArea');

const paymentLabels = {
    free: 'Бесплатно',
    freemium: 'Бесплатно с лимитами',
    paid: 'Платно',
};
const categoryLabels = {
    text: 'Текст', code: 'Кодинг', art: 'Графика',
    video: 'Аудио и видео', '3d': '3D', assistant: 'Ассистенты',
};
const coverGradients = {
    text: 'linear-gradient(120deg,#6366f1,#0ea5e9)',
    code: 'linear-gradient(120deg,#0ea5e9,#10b981)',
    art: 'linear-gradient(120deg,#ec4899,#f59e0b)',
    video: 'linear-gradient(120deg,#f43f5e,#8b5cf6)',
    '3d': 'linear-gradient(120deg,#8b5cf6,#22d3ee)',
    assistant: 'linear-gradient(120deg,#14b8a6,#6366f1)',
};

let tools = [];
let activeFilter = 'all';
let query = '';
const compare = new Set();

async function api(url, options = {}) {
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Что-то пошло не так');
    return data;
}

function logoHtml(t) {
    return `<img src="https://www.google.com/s2/favicons?domain=${t.domain}&sz=128" alt=""
        onerror="this.outerHTML='<span style=font-weight:650>${t.name[0]}</span>'">`;
}

function render() {
    const payment = document.getElementById('paymentSel').value;
    const vpn = document.getElementById('vpnSel').value;
    const sort = document.getElementById('sortSel').value;
    const q = query.toLowerCase();

    const filtered = tools.filter(t => {
        const matchCat = activeFilter === 'all' || t.category === activeFilter;
        const matchQ = t.name.toLowerCase().includes(q)
            || t.desc.toLowerCase().includes(q)
            || (t.tags || []).some(tag => tag.toLowerCase().includes(q));
        const matchPay = payment === 'all' || t.payment === payment;
        const matchVpn = vpn === 'all' || t.vpn === vpn;
        return matchCat && matchQ && matchPay && matchVpn;
    }).sort((a, b) => sort === 'reviews'
        ? (b.ratingsCount ?? 0) - (a.ratingsCount ?? 0)
        : (b.userAvg ?? b.rating) - (a.userAvg ?? a.rating));

    grid.innerHTML = filtered.map(t => `
        <div class="item" data-id="${t.id}" data-name="${t.name}">
            <span class="cover" data-cover="${t.domain}"></span>
            <span class="cover-fallback" style="background:${coverGradients[t.category]}"></span>
            <label class="mark" title="Добавить к сравнению">
                <input type="checkbox" data-compare="${t.id}" style="position:absolute;opacity:0;pointer-events:none">
                <span style="position:relative;display:grid;place-items:center;width:100%;height:100%">
                    <img src="https://www.google.com/s2/favicons?domain=${t.domain}&sz=128" alt=""
                        onerror="this.outerHTML='<span style=font-weight:650>${t.name[0]}</span>'">
                    <span class="mark-tick" hidden>✓</span>
                </span>
            </label>
            <a class="name-link" href="/tool/${t.id}">
                <span class="name">${t.name}</span>
                <span class="host">${t.domain}</span>
                <span class="item-tags">${(t.tags || []).slice(0, 3).map(x => `<i>${x}</i>`).join('')}<span class="live" hidden></span></span>
            </a>
            <span class="desc">${t.desc}</span>
            <span class="limits" title="${t.limits}">${t.limits}</span>
            <span class="pill">${paymentLabels[t.payment]}</span>
            <span class="pill ${t.vpn === 'Без VPN' ? 'ok' : 'bad'}">${t.vpn}</span>
            <span class="rate"><b>${(t.userAvg ?? t.rating).toFixed(1)}</b> · ${t.ratingsCount ?? 0}</span>
        </div>
    `).join('');

    emptyMsg.hidden = filtered.length > 0;
    syncCompareUI();
    loadCovers(filtered);
}

/* ---------- обложки из og:image (лениво, в фоне) ---------- */
const coverObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            coverObserver.unobserve(entry.target);
            fetch('/api/preview?domain=' + entry.target.dataset.cover)
                .then(r => r.ok ? r.json() : null)
                .then(data => {
                    if (!data || !data.image) return;
                    entry.target.style.backgroundImage = `url("${data.image}")`;
                    entry.target.closest('.item').classList.add('has-cover');
                })
                .catch(() => { });
        });
    }, { rootMargin: '120px' })
    : null;

function loadCovers(list) {
    if (!coverObserver) return;
    list.forEach(t => {
        const el = document.querySelector(`.cover[data-cover="${CSS.escape(t.domain)}"]`);
        if (el) coverObserver.observe(el);
    });
}

/* ---------- шторка сравнения (iOS sheet) ---------- */
const sheetRoot = document.getElementById('sheetRoot');
const sheetItems = document.getElementById('sheetItems');
const sheetCount = document.getElementById('sheetCount');
const sheetCompare = document.getElementById('sheetCompare');

function syncCompareUI() {
    grid.querySelectorAll('[data-compare]').forEach(cb => {
        const on = compare.has(Number(cb.dataset.compare));
        cb.checked = on;
        cb.closest('.mark').classList.toggle('is-picked', on);
        cb.closest('.mark').querySelector('.mark-tick').hidden = !on;
    });

    const picked = [...compare].map(id => tools.find(t => t.id === id)).filter(Boolean);
    sheetCount.textContent = `${picked.length} выбрано`;
    sheetItems.innerHTML = picked.map(t => `
        <span class="sheet-item">
            ${t.name}
            <button data-drop="${t.id}" aria-label="Убрать ${t.name}">×</button>
        </span>`).join('');
    sheetCompare.disabled = picked.length < 2;

    if (picked.length) openSheet();
    else closeSheet();
}

function openSheet() {
    sheetRoot.classList.add('is-open');
    sheetRoot.setAttribute('aria-hidden', 'false');
    const sheet = sheetRoot.querySelector('.sheet');
    if (window.__motion) {
        window.__motion.animate(sheet, { y: [120, 0], opacity: [0, 1], scale: [.98, 1] }, spring());
    } else {
        sheet.style.transform = 'translateX(-50%)';
        sheet.animate([{ transform: 'translateX(-50%) translateY(110%)' }, { transform: 'translateX(-50%) translateY(0)' }], { duration: 320, easing: 'cubic-bezier(.32,.72,0,1)' });
    }
}
function closeSheet() {
    if (!sheetRoot.classList.contains('is-open')) return;
    sheetRoot.classList.remove('is-open');
    sheetRoot.setAttribute('aria-hidden', 'true');
}

grid.addEventListener('change', e => {
    const cb = e.target.closest('[data-compare]');
    if (!cb) return;
    const id = Number(cb.dataset.compare);
    if (cb.checked) {
        if (compare.size >= 3) { cb.checked = false; showToast('Можно сравнить не больше трёх'); return; }
        compare.add(id);
    } else compare.delete(id);
    syncCompareUI();
});

grid.addEventListener('click', e => {
    const drop = e.target.closest('[data-drop]');
    if (drop) { compare.delete(Number(drop.dataset.drop)); syncCompareUI(); return; }
    if (e.target.closest('.mark')) return;
    const link = e.target.closest('.name-link');
    if (link) return;
});

sheetCompare.addEventListener('click', () => {
    const ids = [...compare];
    location.href = '/compare.html?a=' + ids[0] + '&b=' + ids[1] + (ids[2] ? '&c=' + ids[2] : '');
});
sheetRoot.querySelectorAll('[data-sheet-close]').forEach(el => el.addEventListener('click', closeSheet));
addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

/* ---------- фильтры ---------- */
filtersWrap.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    filtersWrap.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'));
    btn.setAttribute('aria-pressed', 'true');
    activeFilter = btn.dataset.filter;
    render();
    syncUrl();
});
searchInput.addEventListener('input', () => { query = searchInput.value; render(); });
['paymentSel', 'vpnSel', 'sortSel'].forEach(id => document.getElementById(id).addEventListener('change', () => { render(); syncUrl(); }));

/* блик стекла следует за курсором */
document.querySelectorAll('.panel.glass').forEach(panel => {
    panel.classList.add('lit');
    panel.addEventListener('pointermove', e => {
        const r = panel.getBoundingClientRect();
        panel.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        panel.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
});

/* ---------- авторизация ---------- */
function renderAuth(user) {
    if (user) {
        const avatar = user.avatar
            ? `<img class="avatar" style="width:24px;height:24px" src="${user.avatar}" alt="">`
            : `<span class="avatar-initial" style="width:24px;height:24px;font-size:11px">${user.username[0].toUpperCase()}</span>`;
        authArea.innerHTML = `
            <a class="btn quiet" href="profile.html" style="padding:0 14px 0 8px;gap:8px">${avatar}${user.username}</a>
            <button class="btn" id="logoutBtn">Выйти</button>`;
        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await api('/api/logout', { method: 'POST' });
            showToast('Вы вышли из аккаунта');
            renderAuth(null);
        });

        // Ссылка на редактор появляется только у админа — проверяем молча
        fetch('/api/admin/stale', { credentials: 'same-origin' }).then(r => {
            if (!r.ok) return;
            authArea.insertAdjacentHTML('afterbegin',
                '<a class="btn quiet" href="admin.html" title="Редактор каталога" style="padding:0 13px">Правки</a>');
        }).catch(() => { });
    } else {
        authArea.innerHTML = `
            <button class="btn quiet" id="loginBtn">Войти</button>
            <button class="btn primary" id="registerBtn">Регистрация</button>`;
        document.getElementById('loginBtn').addEventListener('click', () => openModal('loginModal'));
        document.getElementById('registerBtn').addEventListener('click', () => openModal('registerModal'));
    }
}

/* ---------- модалки ---------- */
function openModal(id) { document.getElementById(id).hidden = false; }
document.querySelectorAll('.modal').forEach(modal => {
    modal.querySelector('[data-close]').addEventListener('click', () => modal.hidden = true);
    modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
});
addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal:not([hidden])').forEach(m => m.hidden = true);
});

document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const err = document.getElementById('loginError');
    try {
        const { user } = await api('/api/login', {
            method: 'POST',
            body: JSON.stringify({ username: f.username.value, password: f.password.value }),
        });
        err.textContent = '';
        f.reset();
        document.getElementById('loginModal').hidden = true;
        showToast(`С возвращением, ${user.username}`);
        renderAuth(user);
    } catch (ex) { err.textContent = ex.message; }
});

document.getElementById('registerForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const err = document.getElementById('registerError');
    try {
        const { user } = await api('/api/register', {
            method: 'POST',
            body: JSON.stringify({ username: f.username.value, email: f.email.value, password: f.password.value }),
        });
        err.textContent = '';
        f.reset();
        document.getElementById('registerModal').hidden = true;
        showToast(`Аккаунт создан: ${user.username}`);
        renderAuth(user);
    } catch (ex) { err.textContent = ex.message; }
});

/* ---------- случайный инструмент ---------- */
document.getElementById('luckyBtn')?.addEventListener('click', async () => {
    const { tools: all } = await api('/api/tools');
    const t = all[Math.floor(Math.random() * all.length)];
    location.href = '/tool/' + t.id;
});

/* =========================================================
   Подбор под задачу: 2 шага вопросов → 3 инструмента
   ========================================================= */
const QUIZ = [
    {
        q: 'Что тебе нужно сделать?',
        hint: 'Выбери задачу — покажу три подходящих инструмента.',
        key: 'task',
        options: [
            { v: 'code', em: '</>', t: 'Написать или починить код', to: 'code' },
            { v: 'art', em: '◐', t: 'Нарисовать картинку или логотип', to: 'art' },
            { v: 'video', em: '▶', t: 'Сделать видео или озвучку', to: 'video' },
            { v: 'text', em: '¶', t: 'Текст, перевод или письмо', to: 'text' },
            { v: '3d', em: '◈', t: '3D-модель или анимацию', to: '3d' },
            { v: 'search', em: '⌕', t: 'Найти и разобрать информацию', to: 'assistant' },
        ],
    },
    {
        q: 'Что важнее?',
        hint: 'От этого зависит, какие ограничения считать допустимыми.',
        key: 'need',
        options: [
            { v: 'free', em: '0 ₽', t: 'Только бесплатные', flag: 'free' },
            { v: 'novpn', em: '⇅', t: 'Чтобы работало без VPN', flag: 'novpn' },
            { v: 'fast', em: '⚡', t: 'Чтобы отвечало быстро', flag: 'fast' },
            { v: 'any', em: '◇', t: 'Не важно, подойдёт лучшее', flag: 'any' },
        ],
    },
];

const quizRoot = document.getElementById('quiz');
let quizStep = 0;
const quizAnswers = {};

function openQuiz() {
    quizRoot.classList.add('is-open');
    quizRoot.setAttribute('aria-hidden', 'false');
    drawQuiz();
}

function closeQuiz() {
    quizRoot.classList.remove('is-open');
    quizRoot.setAttribute('aria-hidden', 'true');
}

function drawQuiz() {
    const step = QUIZ[quizStep];
    document.getElementById('quizStep').textContent = `шаг ${quizStep + 1} из ${QUIZ.length}`;
    document.getElementById('quizTitle').textContent = step.q;
    document.getElementById('quizHint').textContent = step.hint;
    document.getElementById('quizNote').textContent = quizStep ? 'Назад меняет первый выбор' : '';
    document.getElementById('quizBody').innerHTML = step.options.map(o => `
        <button class="quiz-q" data-v="${o.v}">
            <span class="em" aria-hidden="true">${o.em}</span>
            <span>${o.t}</span>
        </button>`).join('');
}

function quizScore(tool, task, need) {
    let s = 0;
    const why = [];
    if (tool.category === task) { s += 10; why.push('прямо под эту задачу'); }
    if (need === 'free' && tool.payment === 'free') { s += 6; why.push('полностью бесплатно'); }
    if (need === 'novpn' && tool.vpn === 'Без VPN') { s += 6; why.push('доступен без VPN'); }
    if (need === 'fast' && /Очень|Быстро/.test(tool.speed)) { s += 5; why.push('быстрый отклик'); }
    if (tool.vpn === 'Без VPN') s += 2;
    if (tool.noSignup) s += 2;
    s += (tool.userAvg ?? tool.rating) / 2;
    return { s, why };
}

async function showQuizResult() {
    const task = quizAnswers.task;
    const need = quizAnswers.need || 'any';
    const want = QUIZ[0].options.find(o => o.v === task).to;

    // фильтруем по главному условию, но оставляем запасной вариант
    let pool = tools.filter(t => t.category === want);
    if (!pool.length) pool = tools.slice();
    if (need === 'free') {
        const free = pool.filter(t => t.payment === 'free');
        if (free.length) pool = free;
    }
    if (need === 'novpn') {
        const open = pool.filter(t => t.vpn === 'Без VPN');
        if (open.length) pool = open;
    }

    const top = pool.map(t => ({ t, ...quizScore(t, want, need) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 3);

    document.getElementById('quizStep').textContent = 'результат';
    document.getElementById('quizTitle').textContent = 'Вот что подойдёт';
    document.getElementById('quizHint').textContent = 'Подбор по категории, цене и доступности из каталога.';
    document.getElementById('quizNote').textContent = '';
    document.getElementById('quizBody').innerHTML = `
        <div class="quiz-res">
            ${top.map(({ t, why }) => `
                <a class="quiz-pick" href="/tool/${t.id}">
                    <span class="em" aria-hidden="true">${(categoryLabels[t.category] || 'AI')[0]}</span>
                    <span class="txt">
                        <b>${t.name}</b>
                        <span class="quiz-why">${why.length ? why.join(' · ') : t.desc}</span>
                    </span>
                    <span class="m-label">★ ${(t.userAvg ?? t.rating).toFixed(1)}</span>
                </a>`).join('')}
        </div>
        <div class="quiz-foot">
            <button class="btn quiet" id="quizAgain" style="height:34px;padding:0 14px;font-size:14px">Пройти заново</button>
            <a class="btn" href="#catalog" data-quiz-close style="height:34px;padding:0 14px;font-size:14px">Весь каталог</a>
        </div>`;
}

document.getElementById('quizBtn').addEventListener('click', () => {
    quizStep = 0;
    quizAnswers.task = null;
    quizAnswers.need = null;
    openQuiz();
});

quizRoot.addEventListener('click', e => {
    if (e.target.closest('[data-quiz-close]')) { closeQuiz(); return; }

    const opt = e.target.closest('.quiz-q');
    if (opt) {
        const step = QUIZ[quizStep];
        quizAnswers[step.key] = opt.dataset.v;
        if (quizStep < QUIZ.length - 1) { quizStep++; drawQuiz(); }
        else showQuizResult();
        return;
    }

    if (e.target.closest('#quizAgain')) {
        quizStep = 0;
        quizAnswers.task = null;
        quizAnswers.need = null;
        drawQuiz();
    }
});

addEventListener('keydown', e => {
    if (e.key === 'Escape' && quizRoot.classList.contains('is-open')) closeQuiz();
});

/* ---------- нижняя навигация: подсветка активного раздела ---------- */
const tabbarLinks = [...document.querySelectorAll('.tabbar a')];
const sectionIds = ['catalog', 'calc', 'daily', 'community'];

if (tabbarLinks.length && 'IntersectionObserver' in window) {
    const markActive = id => {
        tabbarLinks.forEach(a => {
            const isOn = a.getAttribute('href') === '#' + id
                || (a.getAttribute('href') === '#catalog' && id === 'catalog');
            if (a.hasAttribute('aria-current')) {
                if (isOn) a.setAttribute('aria-current', 'page');
                else a.removeAttribute('aria-current');
            }
        });
    };

    const seen = new Set();
    const spy = new IntersectionObserver(entries => {
        entries.forEach(e => {
            if (e.isIntersecting) seen.add(e.target.id);
            else seen.delete(e.target.id);
        });
        // из видимых берём самый верхний по документу
        const visible = sectionIds.filter(id => seen.has(id));
        if (visible.length) markActive(visible[0]);
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

    sectionIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) spy.observe(el);
    });

    tabbarLinks.forEach(a => a.addEventListener('click', () => {
        const id = a.getAttribute('href').replace('#', '');
        if (sectionIds.includes(id)) markActive(id);
    }));
}

/* ---------- стек-билдер ---------- */
let builderCat = 'code';
document.getElementById('builderCats').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    document.querySelectorAll('#builderCats button').forEach(b => b.setAttribute('aria-pressed', 'false'));
    btn.setAttribute('aria-pressed', 'true');
    builderCat = btn.dataset.cat;
});

const taskNames = {
    code: 'разработка кода',
    art: 'дизайн и 3D',
    text: 'работа с текстом',
    video: 'видео и аудио',
};

document.getElementById('buildBtn').addEventListener('click', async () => {
    const res = await api('/api/tools');
    const free = document.getElementById('fFree').checked;
    const noSignup = document.getElementById('fNoSignup').checked;
    const cats = builderCat === 'art' ? ['art', '3d'] : [builderCat];

    const matched = res.tools
        .filter(t => cats.includes(t.category) && (!free || t.free) && (!noSignup || t.noSignup))
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 3);

    const box = document.getElementById('buildResult');
    if (!matched.length) {
        box.innerHTML = '<p class="empty">Под такие ограничения ничего не подошло. Снимите галочки и попробуйте снова.</p>';
        return;
    }

    const prompt = `Задача: ${taskNames[builderCat]}.\nИнструменты: ${matched.map(t => t.name).join(', ')}.\nНачни с ${matched[0].name}: предложи 3 шага и сразу приступай к первому.`;

    box.innerHTML = `
        <p class="m-label">подборка</p>
        ${matched.map(t => `
            <div class="pick">
                <span class="pill">${paymentLabels[t.payment]}</span>
                <span><b>${t.name}</b> <span class="host">${t.domain}</span></span>
                <a class="btn" style="height:34px;padding:0 15px;font-size:14px" href="/tool/${t.id}">Открыть</a>
            </div>`).join('')}
        <p class="prompt" id="promptText"></p>
        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
            <button class="btn" id="copyPrompt">Скопировать промпт</button>
            <button class="btn primary" id="saveStack">Сохранить в Мой стек</button>
        </div>
        <p class="m-label" id="stackMsg" style="margin-top:10px"></p>`;

    document.getElementById('promptText').textContent = prompt;

    document.getElementById('copyPrompt').addEventListener('click', async e => {
        await navigator.clipboard.writeText(prompt);
        showToast('Промпт скопирован');
        e.target.textContent = 'Скопировано';
    });

    document.getElementById('saveStack').addEventListener('click', async () => {
        const r = await api('/api/stack', {
            method: 'POST',
            body: JSON.stringify({ toolIds: matched.map(t => t.id) }),
        });
        document.getElementById('stackMsg').textContent = `Сохранено в Мой стек: ${r.count}`;
        showToast('Стек сохранён');
    });
});

/* ---------- live radar ---------- */
const RADAR_SHOWN = 5;

const statusNote = {
    operational: 'Отвечает в норме. Замер — обычный запрос к сайту сервиса.',
    degraded: 'Отвечает, но заметно медленнее обычного. Бывает в часы пик.',
    down: 'Запрос не прошёл: сервер не ответил или вернул ошибку 5xx.',
    blocked: 'Маршрут закрыт — сервис не отвечает без VPN. Это не поломка, а блокировка.',
    unknown: 'Замер ещё не выполнен, данных пока нет.',
};
const statusLabel = s => s === 'operational' ? 'Работает'
    : s === 'degraded' ? 'Замедлен'
        : s === 'down' ? 'Недоступен'
            : s === 'blocked' ? 'Нужен VPN' : 'Нет данных';
// timeout ≠ сервис упал: это почти всегда режет маршрут провайдера
const statusReason = s => s.error === 'timeout'
    ? 'Сервер не успел ответить за 8 секунд. Чаще всего это не поломка сервиса, а блокировка маршрута вашим провайдером.'
    : s.error === 'unreachable'
        ? 'Соединение не установилось — DNS или сеть до этого адреса не пускает.'
        : '';

async function loadRadar() {
    const box = document.getElementById('radarBox');
    try {
        const { services, tools: toolStatus, summary, method } = await api('/api/radar');
        const openIdx = [...box.querySelectorAll('.svc')].findIndex(r => r.classList.contains('open'));

        const overall = summary.down ? 'bad' : summary.degraded ? 'warn' : '';
        const headline = summary.total
            ? (summary.down
                ? `${summary.down} из ${summary.total} сервисов сейчас не отвечают`
                : summary.blocked
                    ? `${summary.total - summary.blocked} из ${summary.total} отвечают, ещё ${summary.blocked} закрыты маршрутом`
                    : summary.degraded
                        ? `все ${summary.total} отвечают, но ${summary.degraded} медленнее обычного`
                    : `все ${summary.total} сервисов отвечают в норме`)
            : 'идёт первый замер';

        box.innerHTML = `
            <header>
                <span class="m-label">статус сервисов каталога</span>
                <span class="m-label right">${method || ''}</span>
            </header>
            <p class="radar-head">
                <span class="dot ${overall}"></span>
                <b>${headline}</b>
            </p>` +
            toolStatus.slice(0, RADAR_SHOWN).map(s => `
                <div class="svc" tabindex="0" role="button" aria-expanded="false">
                    <span class="dot ${s.status === 'degraded' ? 'warn' : s.status === 'down' ? 'bad' : s.status === 'blocked' ? 'warn' : ''}"></span>
                    <b>${s.name}</b>
                    <span class="st">${statusLabel(s.status)}</span>
                    <span class="up">${s.uptime24h !== null ? 'аптайм ' + s.uptime24h + '%' : '—'}</span>
                    <span class="lat">${s.latency !== null ? s.latency + ' мс' : '—'}</span>
                </div>
                <div class="svc-detail"><div>
                    <p>${statusNote[s.status]}</p>
                    ${s.error ? `<p style="padding-top:0">${statusReason(s)}</p>` : ''}
                    <p class="m-label" style="padding-top:0">Проверено ${s.checkedAt ? new Date(s.checkedAt).toLocaleString('ru-RU') : '—'} · замеров за сутки: ${s.checks || 0}</p>
                </div></div>
            `).join('') +
            (toolStatus.length > RADAR_SHOWN
                ? `<button class="radar-more" id="radarMore">Показать остальные ${toolStatus.length - RADAR_SHOWN}</button>
                   <div id="radarRest" hidden>${toolStatus.slice(RADAR_SHOWN).map(s => `
                <div class="svc" tabindex="0" role="button" aria-expanded="false">
                    <span class="dot ${s.status === 'degraded' ? 'warn' : s.status === 'down' ? 'bad' : s.status === 'blocked' ? 'warn' : ''}"></span>
                    <b>${s.name}</b>
                    <span class="st">${statusLabel(s.status)}</span>
                    <span class="up">${s.uptime24h !== null ? 'аптайм ' + s.uptime24h + '%' : '—'}</span>
                    <span class="lat">${s.latency !== null ? s.latency + ' мс' : '—'}</span>
                </div>
                <div class="svc-detail"><div>
                    <p>${statusNote[s.status]}</p>
                    ${s.error ? `<p style="padding-top:0">${statusReason(s)}</p>` : ''}
                    <p class="m-label" style="padding-top:0">Проверено ${s.checkedAt ? new Date(s.checkedAt).toLocaleString('ru-RU') : '—'} · замеров за сутки: ${s.checks || 0}</p>
                </div></div>
            `).join('')}</div>`
                : '');

        const moreBtn = document.getElementById('radarMore');
        if (moreBtn) {
            moreBtn.addEventListener('click', () => {
                const rest = document.getElementById('radarRest');
                rest.hidden = !rest.hidden;
                moreBtn.textContent = rest.hidden
                    ? `Показать остальные ${toolStatus.length - RADAR_SHOWN}`
                    : 'Свернуть список';
            });
        }

        if (openIdx > -1) {
            const row = box.querySelectorAll('.svc')[openIdx];
            row.classList.add('open');
            row.setAttribute('aria-expanded', 'true');
            row.nextElementSibling.classList.add('open');
        }

        box.querySelectorAll('.svc').forEach(row => {
            const toggle = () => {
                const open = row.classList.toggle('open');
                row.setAttribute('aria-expanded', String(open));
                row.nextElementSibling.classList.toggle('open');
            };
            row.addEventListener('click', toggle);
            row.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
            });
        });

        // Статус подставляется в строки каталога
        const map = new Map(toolStatus.map(s => [s.name, s.status]));
        document.querySelectorAll('.item[data-name]').forEach(el => {
            const st = map.get(el.dataset.name);
            if (!st) return;
            const badge = el.querySelector('.live');
            if (!badge) return;
            badge.hidden = false;
            badge.className = 'live ' + (st === 'operational' ? '' : st === 'down' ? 'bad' : 'warn');
            badge.textContent = statusLabel(st);
        });
    } catch {
        box.innerHTML = '<header><span class="m-label">статус сервисов каталога</span></header>'
            + '<p class="radar-head"><b>Не удалось загрузить статус. Обновите страницу.</b></p>';
    }
}
loadRadar();
setInterval(loadRadar, 10000);

/* ---------- наверх ---------- */
const toTop = document.getElementById('toTop');
addEventListener('scroll', () => toTop.classList.toggle('show', scrollY > 700), { passive: true });
toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

/* ---------- deep-links: состояние фильтров в URL ---------- */
function syncUrl() {
    const p = new URLSearchParams();
    if (activeFilter !== 'all') p.set('cat', activeFilter);
    const pay = document.getElementById('paymentSel').value;
    const vpn = document.getElementById('vpnSel').value;
    const sort = document.getElementById('sortSel').value;
    if (pay !== 'all') p.set('pay', pay);
    if (vpn !== 'all') p.set('vpn', vpn);
    if (sort !== 'rating') p.set('sort', sort);
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
}

function readUrl() {
    const p = new URLSearchParams(location.search);
    const cat = p.get('cat');
    if (cat && [...filtersWrap.querySelectorAll('button')].some(b => b.dataset.filter === cat)) {
        activeFilter = cat;
        filtersWrap.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === cat)));
    }
    const pay = p.get('pay');
    if (pay) document.getElementById('paymentSel').value = pay;
    const vpn = p.get('vpn');
    if (vpn) document.getElementById('vpnSel').value = vpn;
    const sort = p.get('sort');
    if (sort) document.getElementById('sortSel').value = sort;
}

/* ---------- инструмент дня ---------- */
async function loadDaily() {
    const box = document.getElementById('dailyBox');
    if (!box) return;
    try {
        const { tool, prompt } = await api('/api/daily');
        const since = new Date(Date.now() / 86400000 * 86400000);
        box.innerHTML = `
            <div>
                <p class="day-num">${since.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</p>
                <h3><a href="/tool/${tool.id}">${tool.name}</a></h3>
                <p>${tool.desc}</p>
                <p class="prompt">${prompt}</p>
            </div>
            <div style="display:grid;gap:10px">
                <a class="btn" href="/tool/${tool.id}">Открыть</a>
                <button class="btn primary" id="dailyFav">В избранное</button>
            </div>`;
        document.getElementById('dailyFav').addEventListener('click', async () => {
            await api(`/api/tools/${tool.id}/favorite`, { method: 'POST' });
            showToast('Добавлено в избранное');
        });
    } catch { }
}

/* ---------- калькулятор стоимости ---------- */
const calcWork = document.getElementById('calcWork');
const calcVolume = document.getElementById('calcVolume');
const calcFree = document.getElementById('calcFree');
const calcVpn = document.getElementById('calcVpn');
const calcOut = document.getElementById('calcOut');
let calcPeriod = 'month';

async function runCalc() {
    if (!calcOut) return;
    calcOut.innerHTML = '<p class="m-label">Считаю…</p>';
    try {
        const data = await api('/api/calc', {
            method: 'POST',
            body: JSON.stringify({
                volume: Number(calcVolume.value) || 100,
                work: calcWork.value,
                period: calcPeriod,
                freeOnly: calcFree.checked,
                noVpn: calcVpn.checked,
            }),
        });

        if (!data.rows.length) {
            calcOut.innerHTML = '<p class="m-label">Под эти условия не подошёл ни один сервис. Снимите фильтры.</p>';
            return;
        }

        const best = data.best;
        const when = data.period === 'day' ? 'в день' : 'в месяц';
        calcOut.innerHTML = `
            <div class="calc-summary">
                <p class="m-label">${data.label} ${when}</p>
                <b>${data.volume.toLocaleString('ru-RU')} ${data.unit}</b>
                <p>${data.freeCount} из ${data.rows.length} сервисов справятся бесплатно</p>
                ${best ? `<p class="calc-best">Дешевле всего: <b>${best.name}</b> — ${best.verdict}</p>` : ''}
            </div>
            <div class="calc-rows">
                ${data.rows.map(r => `
                    <a class="calc-row${r.fits ? ' is-free' : ''}" href="/tool/${r.id}">
                        <b>${r.name}</b>
                        <span class="calc-free">${r.freeLabel || '—'}</span>
                        <span class="calc-cost ${r.cost === 0 ? 'ok' : ''}">${r.verdict}</span>
                    </a>`).join('')}
            </div>`;
    } catch {
        calcOut.innerHTML = '<p class="m-label">Не удалось посчитать. Обновите страницу.</p>';
    }
}

document.querySelectorAll('[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-period]').forEach(b => b.classList.toggle('is-on', b === btn));
        calcPeriod = btn.dataset.period;
        if (calcPeriod === 'day' && Number(calcVolume.value) > 500) calcVolume.value = 100;
        if (calcPeriod === 'month' && Number(calcVolume.value) < 50) calcVolume.value = 500;
        runCalc();
    });
});

[calcWork, calcVolume, calcFree, calcVpn].forEach(el => el && el.addEventListener('input', runCalc));
[calcWork, calcVolume].forEach(el => el && el.addEventListener('change', runCalc));
runCalc();

/* ---------- счётчик сервисов в шапке ---------- */
api('/api/tools').then(d => {
    const badge = document.getElementById('heroBadge');
    if (!badge || !d.tools) return;
    const n = d.tools.length;
    const word = n % 10 === 1 && n % 100 !== 11 ? 'сервис'
        : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'сервиса' : 'сервисов';
    badge.innerHTML = `<span class="pulse"></span>${n} ${word} · лимиты и цены в цифрах · статус проверяется каждые 5 минут`;
}).catch(() => { });

/* ---------- лента изменений ---------- */
async function loadChanges() {
    const box = document.getElementById('changesBox');
    if (!box) return;
    try {
        const data = await api('/api/changes?days=30');
        if (!data.total) {
            box.innerHTML = '<p class="m-label">Изменений пока не зафиксировано — история условий только набирается.</p>';
            return;
        }
        const FIELD = {
            limits: 'Лимиты', payment: 'Оплата', vpn: 'Доступ', speed: 'Скорость',
            desc: 'Описание', pros: 'Плюсы', cons: 'Минусы',
            free_limit: 'Бесплатный лимит', price: 'Цена', access: 'Доступ',
            feature: 'Возможности', name: 'Название',
        };
        box.innerHTML = `
            <header class="ch-head">
                <span class="m-label">всего записей</span>
                <b>${data.total}</b>
                <span class="m-label">за последние ${data.days} дней — ${data.recentCount}</span>
                <span class="sp" style="flex:1"></span>
                <span class="m-label">последнее: ${data.lastChange
                    ? new Date(data.lastChange).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
                    : '—'}</span>
            </header>
            <div class="ch-list">
                ${data.timeline.slice(0, 8).map(d => `
                    <div class="ch-day">
                        <span class="m-label ch-date">${new Date(d.day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                        ${d.items.map(i => `
                            <a class="ch-row" href="/tool/${i.tool_id}">
                                <b>${i.tool_name}</b>
                                <span class="m-label">${FIELD[i.field] || i.field}</span>
                                <span class="ch-change"><s>${i.old_value || '—'}</s> → <b>${i.new_value}</b></span>
                            </a>`).join('')}
                    </div>`).join('')}
            </div>`;
    } catch {
        box.innerHTML = '<p class="m-label">Не удалось загрузить ленту изменений.</p>';
    }
}

loadChanges();

/* ---------- подборки сообщества ---------- */
async function loadCommunity() {
    const box = document.getElementById('communityBox');
    if (!box) return;
    try {
        const { stacks } = await api('/api/community-stacks');
        box.innerHTML = stacks.map(s => `
            <article class="stack-card">
                <span class="m-label">${s.task}</span>
                <h3>${s.name}</h3>
                ${s.note ? `<p class="stack-note">${s.note}</p>` : ''}
                <div class="tools">${s.tools.map(t => `<a href="/tool/${t.id}">${t.name}</a>`).join('')}</div>
                <div class="foot">
                    <span class="author">${s.author}</span>
                    <span style="flex:1"></span>
                    <button class="btn" data-apply="${s.id}" style="height:34px;padding:0 14px;font-size:14px">В мой стек</button>
                </div>
            </article>`).join('');

        box.addEventListener('click', async e => {
            const btn = e.target.closest('[data-apply]');
            if (!btn) return;
            const stack = stacks.find(s => s.id === Number(btn.dataset.apply));
            await api('/api/stack', { method: 'POST', body: JSON.stringify({ toolIds: stack.tools.map(t => t.id) }) });
            showToast(`Стек «${stack.name}» в вашем Моём стеке`);
        });
    } catch { }
}

loadDaily();
loadCommunity();

/* ---------- старт ---------- */
renderAuth(null);
readUrl();
(async function init() {
    try {
        const data = await api('/api/tools');
        tools = data.tools;
        render();
    } catch {
        grid.innerHTML = '<p class="empty">Каталог временно недоступен. Обновите страницу.</p>';
    }
    try {
        const { user } = await api('/api/me');
        renderAuth(user);
    } catch { /* гость */ }
})();
