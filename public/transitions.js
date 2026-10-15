/* =========================================================
   iOS-переходы между страницами (push / pop) на полной перезагрузке:
   текущая страница уезжает в сторону, новая входит из-за края.
   Направление храним в sessionStorage, чтобы «назад» вёл назад.
   ========================================================= */
(function () {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const KEY = 'nav-direction';
    const dir = sessionStorage.getItem(KEY) || 'enter';
    sessionStorage.removeItem(KEY);

    const app = document.querySelector('main') || document.body;
    const paint = () => {
        document.documentElement.classList.add(dir === 'pop' ? 'nav-pop' : 'nav-enter');
        setTimeout(() => document.documentElement.classList.remove('nav-enter', 'nav-pop'), 420);
    };

    if (app.animate) {
        if (dir === 'pop') {
            app.animate(
                [{ transform: 'translateX(-16%)', opacity: 0 }],
                { duration: 320, easing: 'cubic-bezier(.32,.72,0,1)' }
            );
        } else {
            app.animate(
                [{ transform: 'translateX(22%)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }],
                { duration: 380, easing: 'cubic-bezier(.32,.72,0,1)' }
            );
        }
        paint();
        return;
    }
    paint();

    // уходящая страница: свайп в сторону + лёгкое сжатие
    document.addEventListener('click', e => {
        const link = e.target.closest('a');
        if (!link) return;
        const url = new URL(link.href, location.href);
        if (url.origin !== location.origin) return;
        if (url.pathname === location.pathname && url.hash) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || link.target === '_blank') return;

        e.preventDefault();
        sessionStorage.setItem(KEY, 'pop');
        const out = document.querySelector('main') || document.body;
        out.animate(
            [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-18%)', opacity: .2 }],
            { duration: 260, easing: 'cubic-bezier(.32,.72,0,1)', fill: 'forwards' }
        ).onfinish = () => { location.href = link.href; };
    });
})();