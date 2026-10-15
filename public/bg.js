(function () {
    // тихая сеть на фоне: линии соединяют ближайшие точки, курсор притягивает их
    const canvas = document.createElement('canvas');
    canvas.id = 'netCanvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
    if (reduce || coarse) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    let w, h, points = [];
    const mouse = { x: -9999, y: -9999 };
    let visible = true;

    function resize() {
        const dpr = 1; // без devicePixelRatio — на слабых телефонах это главный тормоз
        w = canvas.width = innerWidth * dpr;
        h = canvas.height = innerHeight * dpr;
        canvas.style.width = innerWidth + 'px';
        canvas.style.height = innerHeight + 'px';
        points = Array.from({ length: Math.min(30, Math.round(innerWidth / 44)) }, () => ({
            x: Math.random() * innerWidth,
            y: Math.random() * innerHeight,
            vx: (Math.random() - .5) * .26,
            vy: (Math.random() - .5) * .26,
        }));
    }
    resize();
    addEventListener('resize', resize);
    addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
    document.addEventListener('visibilitychange', () => {
        visible = !document.hidden;
        if (visible) tick();
    });

    const LINE = 'rgba(120,130,160,.16)';
    const NEAR = 'rgba(184,132,252,.30)';
    const DOT = 'rgba(140,150,180,.45)';

    function tick() {
        if (!visible) return;
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        for (const p of points) {
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0 || p.x > innerWidth) p.vx *= -1;
            if (p.y < 0 || p.y > innerHeight) p.vy *= -1;
        }
        ctx.lineWidth = 1;
        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            for (let j = i + 1; j < points.length; j++) {
                const b = points[j];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d < 120) {
                    ctx.strokeStyle = LINE;
                    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
                }
            }
            const dm = Math.hypot(a.x - mouse.x, a.y - mouse.y);
            if (dm < 150) {
                ctx.strokeStyle = NEAR;
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
            }
            ctx.fillStyle = DOT;
            ctx.beginPath(); ctx.arc(a.x, a.y, 1.2, 0, Math.PI * 2); ctx.fill();
        }
        requestAnimationFrame(tick);
    }
    tick();
})();
