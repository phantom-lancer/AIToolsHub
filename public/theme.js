(function () {
    const root = document.documentElement;
    const meta = document.querySelector('meta[name="theme-color"]');
    const KEY = 'theme';
    const system = window.matchMedia('(prefers-color-scheme: dark)');

    // по умолчанию — «Система»: сайт живёт вместе с Windows/iOS
    let mode = localStorage.getItem(KEY) || 'auto';
    const ORDER = ['auto', 'light', 'dark'];

    function paint() {
        const dark = mode === 'dark' || (mode === 'auto' && system.matches);
        root.dataset.mode = mode;
        root.dataset.theme = dark ? 'dark' : 'light';
        if (meta) meta.content = dark ? '#0d0f13' : '#eef0f4';

        const labels = { auto: 'Тема как в системе', light: 'Светлая тема', dark: 'Тёмная тема' };
        document.querySelectorAll('.theme-toggle').forEach(b => {
            b.setAttribute('aria-label', labels[mode]);
            b.title = labels[mode];
        });
    }

    function apply(next, notify) {
        mode = next;
        localStorage.setItem(KEY, mode);
        paint();
        if (notify && typeof showToast === 'function') {
            const labels = { auto: 'Как в системе', light: 'Светлая', dark: 'Тёмная' };
            showToast('Тема: ' + labels[mode]);
        }
    }

    paint();
    // живая синхронизация со сменой темы в Windows / iOS
    system.addEventListener('change', () => { if (mode === 'auto') paint(); });

    document.addEventListener('click', e => {
        const btn = e.target.closest('.theme-toggle');
        if (!btn) return;
        apply(ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length], true);
    });
})();
