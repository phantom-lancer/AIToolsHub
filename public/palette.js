/* =========================================================
   Командная палитра ⌘K + горячие клавиши
   ========================================================= */
(function () {
    let tools = [];
    let user = null;
    let index = 0;

    fetch('/api/tools').then(r => r.json()).then(d => { tools = d.tools; })
        .catch(() => { });

    const root = document.createElement('div');
    root.className = 'cmd-root';
    root.innerHTML = `
        <div class="cmd-backdrop"></div>
        <div class="cmd glass" role="dialog" aria-modal="true" aria-label="Поиск и команды">
            <div class="cmd-field">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/></svg>
                <input type="text" id="cmdInput" placeholder="Инструменты, страницы, действия…" autocomplete="off" spellcheck="false">
                <kbd>esc</kbd>
            </div>
            <div class="cmd-list" id="cmdList" role="listbox"></div>
            <div class="cmd-foot">
                <span><kbd>↑</kbd><kbd>↓</kbd> навигация</span>
                <span><kbd>↵</kbd> открыть</span>
                <span><kbd>/</kbd> поиск</span>
                <span><kbd>t</kbd> тема</span>
            </div>
        </div>`;
    document.body.appendChild(root);

    const input = root.querySelector('#cmdInput');
    const list = root.querySelector('#cmdList');
    const panel = root.querySelector('.cmd');

    const ACTIONS = [
        { group: 'Навигация', label: 'Каталог', hint: 'все инструменты', icon: '◎', go: () => go('/index.html#catalog') },
        { group: 'Навигация', label: 'Калькулятор', hint: 'сколько стоит', icon: '∑', go: () => go('/index.html#calc') },
        { group: 'Навигация', label: 'Промпты', hint: 'библиотека шаблонов', icon: '❝', go: () => go('/prompts.html') },
        { group: 'Навигация', label: 'Статус сервисов', hint: 'radar', icon: '◉', go: () => go('/index.html#radar') },
        { group: 'Навигация', label: 'Стек-билдер', hint: 'подобрать стек', icon: '⬗', go: () => go('/index.html#builder') },
        { group: 'Навигация', label: 'Сравнение', hint: 'две нейросети', icon: '⇄', go: () => go('/compare.html') },
        { group: 'Навигация', label: 'Что нового', hint: 'changelog', icon: '≡', go: () => go('/changelog.html') },
        { group: 'Действия', label: 'Сменить тему', hint: 'светлая / тёмная', icon: '◐', run: () => document.querySelector('.theme-toggle')?.click() },
        { group: 'Действия', label: 'Мой профиль', hint: user ? user.username : 'гость', icon: '○', run: () => go('/profile.html') },
        { group: 'Действия', label: 'Инструмент дня', hint: 'новый подбор', icon: '★', go: () => go('/index.html#daily') },
    ];

    function go(url) { window.location.href = url; }

    function items(q) {
        const query = q.trim().toLowerCase();
        const pages = ACTIONS.filter(a => !query || a.label.toLowerCase().includes(query));
        const listTools = tools
            .filter(t => !query
                || t.name.toLowerCase().includes(query)
                || t.desc.toLowerCase().includes(query)
                || (t.tags || []).some(tag => tag.toLowerCase().includes(query)))
            .slice(0, 8)
            .map(t => ({
                group: 'Инструменты',
                label: t.name,
                hint: `${t.category} · ★ ${t.rating}`,
                icon: t.name[0],
                go: () => go('/tool/' + t.id),
            }));
        return [...pages, ...listTools];
    }

    function draw() {
        const data = items(input.value);
        index = Math.min(index, Math.max(0, data.length - 1));
        list.innerHTML = data.length ? data.map((it, i) => `
            <button class="cmd-item${i === index ? ' is-active' : ''}" data-i="${i}" role="option">
                <span class="cmd-ico">${it.icon}</span>
                <span class="cmd-text"><b>${it.label}</b><small>${it.group}</small></span>
                <span class="cmd-hint">${it.hint}</span>
            </button>`).join('')
            : '<p class="cmd-empty">Ничего не найдено</p>';
        data.forEach((el, i) => { });
    }

    function open() {
        root.classList.add('is-open');
        input.value = '';
        index = 0;
        draw();
        if (window.__motion) {
            window.__motion.animate(panel, { opacity: [0, 1], transform: ['scale(.94) translateY(-8px)', 'scale(1) translateY(0px)'] }, spring());
        } else {
            panel.style.animation = 'pop .3s cubic-bezier(.32,1.55,.45,1)';
        }
        setTimeout(() => input.focus(), 40);
    }

    function close() {
        root.classList.remove('is-open');
        if (window.__motion) window.__motion.animate(panel, { opacity: 0, transform: 'scale(.96)' }, { duration: .16 });
        else panel.style.animation = '';
    }

    list.addEventListener('click', e => {
        const btn = e.target.closest('.cmd-item');
        if (!btn) return;
        const data = items(input.value);
        const action = data[Number(btn.dataset.i)];
        if (!action) return;
        close();
        action.go ? action.go() : action.run();
    });

    list.addEventListener('mousemove', e => {
        const btn = e.target.closest('.cmd-item');
        if (!btn) return;
        index = Number(btn.dataset.i);
        list.querySelectorAll('.cmd-item').forEach(el => el.classList.toggle('is-active', el === btn));
    });

    input.addEventListener('input', () => { index = 0; draw(); });

    root.querySelector('.cmd-backdrop').addEventListener('click', close);

    addEventListener('keydown', e => {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            root.classList.contains('is-open') ? close() : open();
            return;
        }
        if (e.key === 'Escape' && root.classList.contains('is-open')) { close(); return; }
        if (root.classList.contains('is-open')) {
            const data = items(input.value);
            if (e.key === 'ArrowDown') { e.preventDefault(); index = (index + 1) % data.length; draw(); }
            if (e.key === 'ArrowUp') { e.preventDefault(); index = (index - 1 + data.length) % data.length; draw(); }
            if (e.key === 'Enter') {
                e.preventDefault();
                const action = data[index];
                if (action) { close(); action.go ? action.go() : action.run(); }
            }
            return;
        }
        if (typing) return;
        if (e.key === '/') { e.preventDefault(); open(); }
        if (e.key.toLowerCase() === 't') document.querySelector('.theme-toggle')?.click();
    });

    // кнопка-подсказка в интерфейсе
    document.addEventListener('click', e => {
        if (e.target.closest('[data-open-cmd]')) open();
    });

    fetch('/api/me', { credentials: 'same-origin' })
        .then(r => r.ok ? r.json() : null)
        .then(d => { user = d && d.user; })
        .catch(() => { });

    window.openCommandPalette = open;
})();