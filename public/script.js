const grid = document.getElementById('grid');
const searchInput = document.getElementById('searchInput');
const filtersWrap = document.getElementById('filters');
const emptyMsg = document.getElementById('emptyMsg');
const authArea = document.getElementById('authArea');

const categoryNames = { text: 'Текст', code: 'Код', art: 'Арт', video: 'Видео' };
let tools = [];
let activeFilter = 'all';
let query = '';

function render() {
    const filtered = tools.filter(t => {
        const matchCat = activeFilter === 'all' || t.category === activeFilter;
        const q = query.toLowerCase();
        const matchQ = t.name.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q);
        return matchCat && matchQ;
    });
    grid.innerHTML = filtered.map(t => `
        <a class="card glass" style="display:block;text-decoration:none;color:inherit" href="tool.html?id=${t.id}">
            <span class="card-badge badge-${t.category}">${categoryNames[t.category]}</span>
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
