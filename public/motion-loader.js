/* Мобильный (iOS-like) library.js -> motion.js с CDN, иначе — CSS-запасной путь */
let motion = null;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

async function loadMotion() {
    if (reduced) return null;
    try {
        const m = await import('https://cdn.jsdelivr.net/npm/motion@11.11.13/+esm');
        return m;
    } catch { return null; }
}

function spring(opts = {}) {
    if (motion) return motion.spring({ stiffness: 320, damping: 26, mass: .9, ...opts });
    return { duration: .34 };
}