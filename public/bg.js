(function () {
    const canvas = document.createElement('canvas');
    canvas.id = 'netCanvas';
    document.body.prepend(canvas);
    const glow = document.createElement('div');
    glow.id = 'cursorGlow';
    document.body.appendChild(glow);

    const ctx = canvas.getContext('2d');
    let w, h, points = [];
    const mouse = { x: -999, y: -999 };

    function resize() {
        w = canvas.width = innerWidth;
        h = canvas.height = innerHeight;
        points = Array.from({ length: Math.min(70, innerWidth / 18) }, () => ({
            x: Math.random() * w, y: Math.random() * h,
            vx: (Math.random() - .5) * .5, vy: (Math.random() - .5) * .5,
        }));
    }
    resize();
    addEventListener('resize', resize);
    addEventListener('mousemove', e => {
        mouse.x = e.clientX; mouse.y = e.clientY;
        glow.style.transform = `translate(${e.clientX - 150}px, ${e.clientY - 150}px)`;
    });

    function tick() {
        ctx.clearRect(0, 0, w, h);
        points.forEach(p => {
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0 || p.x > w) p.vx *= -1;
            if (p.y < 0 || p.y > h) p.vy *= -1;
        });
        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            for (let j = i + 1; j < points.length; j++) {
                const b = points[j];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (d < 130) {
                    ctx.strokeStyle = `rgba(124,58,237,${0.14 * (1 - d / 130)})`;
                    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
                }
            }
            const dm = Math.hypot(a.x - mouse.x, a.y - mouse.y);
            if (dm < 160) {
                ctx.strokeStyle = `rgba(6,182,212,${0.35 * (1 - dm / 160)})`;
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
            }
            ctx.fillStyle = 'rgba(168,139,250,.5)';
            ctx.beginPath(); ctx.arc(a.x, a.y, 1.6, 0, 7); ctx.fill();
        }
        requestAnimationFrame(tick);
    }
    tick();
})();
