(function () {
    const root = document.documentElement;
    const stored = localStorage.getItem('theme') || 'auto';

    function apply(mode) {
        if (mode === 'auto') {
            root.removeAttribute('data-theme');
        } else {
            root.setAttribute('data-theme', mode);
        }
    }
    apply(stored);

    window.setTheme = function (mode) {
        localStorage.setItem('theme', mode);
        apply(mode);
        const sel = document.getElementById('themeSelect');
        if (sel) sel.value = mode;
    };

    document.addEventListener('DOMContentLoaded', () => {
        const sel = document.getElementById('themeSelect');
        if (sel) {
            sel.value = localStorage.getItem('theme') || 'auto';
            sel.addEventListener('change', () => setTheme(sel.value));
        }
    });
})();
