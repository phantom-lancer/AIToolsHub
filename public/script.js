const grid = document.getElementById('grid');
const searchInput = document.getElementById('searchInput');
const filtersWrap = document.getElementById('filters');
const emptyMsg = document.getElementById('emptyMsg');
const authArea = document.getElementById('authArea');

const categoryNames = { text: 'Текст', code: 'Кодинг', art: 'Графика', video: 'Аудио/Видео', '3d': '3D', assistant: 'Ассистенты' };
const categoryEmoji = { text: '✍️', code: '💻', art: '🎨', video: '🎬', '3d': '🧊', assistant: '🤖' };

const paymentLabels = { free: 'Бесплатно', freemium: 'Freemium', paid: 'Платно' };
let tools = [];
let activeFilter = 'all';
let query = '';

function render() {
    const payment = document.getElementById('paymentSel').value;
    const vpn = document.getElementById('vpnSel').value;
    const sort = document.getElementById('sortSel').value;
    const q = query.toLowerCase();
    const filtered = tools.filter(t => {
        const matchCat = activeFilter === 'all' || t.category === activeFilter;
        const matchQ = t.name.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q) || (t.tags || []).some(tag => tag.toLowerCase().includes(q));
        const matchPay = payment === 'all' || t.payment === payment;
        const matchVpn = vpn === 'all' || t.vpn === vpn;
        return matchCat && matchQ && matchPay && matchVpn;
    }).sort((a, b) => sort === 'reviews' ? (b.ratingsCount ?? 0) - (a.ratingsCount ?? 0) : (b.userAvg ?? b.rating) - (a.userAvg ?? a.rating));
    grid.innerHTML = filtered.map(t => `
        <a class="card glass" style="display:block;text-decoration:none;color:inherit" href="tool.html?id=${t.id}">
            <img class="tool-logo" src="https://www.google.com/s2/favicons?domain=${t.domain}&sz=128" alt="${t.name}" onerror="this.outerHTML='&lt;div class=tool-logo logo-fallback&gt;${t.name[0]}&lt;/div&gt;'">
            <span class="card-badge badge-${t.category}">${categoryNames[t.category]}</span>
            <span class="card-badge" style="background:rgba(255,255,255,.08);color:var(--muted)">${paymentLabels[t.payment]}</span>
            <span class="card-badge" style="background:${t.vpn === 'Без VPN' ? 'rgba(52,211,153,.15);color:#34d399' : 'rgba(248,113,113,.15);color:#f87171'}">${t.vpn}</span>
            <h3>${t.name}</h3>
            <p>${t.desc}</p>
            <span class="card-rating">★ ${t.userAvg ?? t.rating}</span>${t.ratingsCount ? ` <small style="color:var(--muted)">(${t.ratingsCount} оценок)</small>` : ''}
        </a>
    `).join('');
    emptyMsg.hidden = filtered.length > 0;
}

filtersWrap.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    filtersWrap.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    render();
});

searchInput.addEventListener('input', () => { query = searchInput.value; render(); });
['paymentSel', 'vpnSel', 'sortSel'].forEach(id => document.getElementById(id).addEventListener('change', render));

async function api(url, options = {}) {
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка');
    return data;
}

function renderAuth(user) {
    if (user) {
        authArea.innerHTML = `
            <span class="user-chip">${user.avatar ? `<img src="${user.avatar}" class="avatar" style="width:22px;height:22px;vertical-align:-6px;margin-right:6px">` : ''}<a href="profile.html" style="color:inherit;text-decoration:none">${user.username}</a></span>
            <button class="btn-ghost" id="logoutBtn">Выйти</button>
        `;
        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await api('/api/logout', { method: 'POST' });
            renderAuth(null);
        });
    } else {
        authArea.innerHTML = `
            <button class="btn-ghost" id="loginBtn">Войти</button>
            <button class="btn-primary-sm" id="registerBtn">Регистрация</button>
        `;
        document.getElementById('loginBtn').addEventListener('click', () => openModal('loginModal'));
        document.getElementById('registerBtn').addEventListener('click', () => openModal('registerModal'));
    }
}

const modals = document.querySelectorAll('.modal');
function openModal(id) { document.getElementById(id).hidden = false; }
modals.forEach(m => {
    m.querySelector('[data-close]').addEventListener('click', () => m.hidden = true);
    m.addEventListener('click', e => { if (e.target === m) m.hidden = true; });
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
        renderAuth(user);
    } catch (ex) { err.textContent = ex.message; }
});

async function init() {
    try {
        const { tools: t } = await api('/api/tools');
        tools = t;
        render();
    } catch { grid.innerHTML = '<p class="empty">Не удалось загрузить инструменты</p>'; }

    try {
        const { user } = await api('/api/me');
        renderAuth(user);
    } catch { renderAuth(null); }
}

renderAuth(null);
init();

document.getElementById('luckyBtn').addEventListener('click', async () => {
    const res = await fetch('/api/tools');
    const { tools } = await res.json();
    const t = tools[Math.floor(Math.random() * tools.length)];
    location.href = 'tool.html?id=' + t.id;
});

// Smart AI Stack Builder
let builderCat = 'code';
document.getElementById('builderCats').addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    document.querySelectorAll('#builderCats .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    builderCat = btn.dataset.cat;
});

document.getElementById('buildBtn').addEventListener('click', async () => {
    const res = await fetch('/api/tools');
    const { tools: all } = await res.json();
    const free = document.getElementById('fFree').checked;
    const noSignup = document.getElementById('fNoSignup').checked;
    const matched = all.filter(t => (builderCat === 'art' ? ['art', '3d'] : [builderCat]).includes(t.category) && (!free || t.free) && (!noSignup || t.noSignup))
        .sort((a, b) => b.rating - a.rating).slice(0, 3);
    const box = document.getElementById('buildResult');
    if (!matched.length) {
        box.innerHTML = '<p style="color:var(--muted)">Под такие фильтры ничего не подошло. Ослабьте фильтры.</p>';
        return;
    }
    const prompt = `Я работаю над задачей: ${builderCat === 'code' ? 'разработка кода' : builderCat === 'art' ? 'дизайн и 3D' : builderCat === 'text' ? 'работа с текстом' : 'видео/аудио'}. Использую связку инструментов: ${matched.map(t => t.name).join(', ')}. Помоги составить первый рабочий шаг.`;
    box.innerHTML = matched.map((t, i) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border)">
            <div><b>${i + 1}. <a href="tool.html?id=${t.id}" style="color:var(--text)">${t.name}</a></b> <small style="color:var(--muted)">★ ${t.rating} ${t.free ? '· бесплатно' : ''} ${t.noSignup ? '· без регистрации' : ''}</small></div>
        </div>
    `).join('') + `
        <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn-ghost" id="copyPrompt">📋 Копировать стартовый промпт</button>
            <button class="btn-primary-sm" id="saveStack">💾 Сохранить в Мой стек</button>
        </div>
        <p id="stackMsg" style="color:var(--muted);font-size:.85rem;min-height:1.2em"></p>`;
    document.getElementById('copyPrompt').addEventListener('click', async e => {
        await navigator.clipboard.writeText(prompt);
        e.target.textContent = '✓ Скопировано';
    });
    document.getElementById('saveStack').addEventListener('click', async e => {
        const res = await fetch('/api/stack', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolIds: matched.map(t => t.id) }),
        });
        const data = await res.json();
        document.getElementById('stackMsg').textContent = res.ok ? `Сохранено в Мой стек (${data.count} инструмента) ✓` : (data.error || 'Ошибка — войдите в аккаунт');
        if (res.ok) showToast('Стек сохранён 💾');
    });
});

// Live AI Radar
const radarLabels = { operational: 'Работает', degraded: 'Замедлен', down: 'Недоступен' };
const radarColors = { operational: '#34d399', degraded: '#fbbf24', down: '#f87171' };
async function loadRadar() {
    try {
        const res = await fetch('/api/radar');
        const { services } = await res.json();
        document.getElementById('radarBox').innerHTML = services.map(s => `
            <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
                <span style="width:10px;height:10px;border-radius:50%;background:${radarColors[s.status]};box-shadow:0 0 10px ${radarColors[s.status]};animation:pulse 1.6s infinite"></span>
                <b style="flex:1">${s.name}</b>
                <span style="color:${radarColors[s.status]}">${radarLabels[s.status]}</span>
                <span style="color:var(--muted);min-width:70px;text-align:right">${s.latency !== null ? s.latency + ' мс' : '—'}</span>
            </div>
        `).join('');
    } catch {}
}
loadRadar();
setInterval(loadRadar, 10000);

// Reveal on scroll
const observer = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); } });
}, { threshold: 0.1 });
function observeReveals() {
    document.querySelectorAll('.card:not(.visible), .section-title').forEach(el => {
        el.classList.add('reveal');
        observer.observe(el);
    });
}
const oldRender = render;
render = function () { oldRender(); observeReveals(); };
observeReveals();

// Back to top
const toTop = document.getElementById('toTop');
addEventListener('scroll', () => toTop.classList.toggle('show', scrollY > 500));
toTop.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));
