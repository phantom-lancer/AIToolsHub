/* Кастомный glass-селект: меню выносится в body и позиционируется через fixed,
   поэтому его не может закрыть ни один стеклянный контейнер. */
(function () {
    const CHEVRON = '<svg width="12" height="8" viewBox="0 0 12 8" fill="none" aria-hidden="true"><path d="M1 1.5 6 6.5l5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    let openWrap = null;
    let menu = null;

    function close() {
        if (!openWrap) return;
        openWrap.classList.remove('open');
        openWrap.querySelector('.gselect-btn').setAttribute('aria-expanded', 'false');
        menu.classList.remove('is-open');
        openWrap = null;
        setTimeout(() => { if (!menu.classList.contains('is-open')) menu.hidden = true; }, 200);
    }

    function place(btn) {
        const r = btn.getBoundingClientRect();
        menu.style.left = Math.round(r.left) + 'px';
        menu.style.width = Math.round(r.width) + 'px';
        menu.style.top = Math.round(r.bottom + 8) + 'px';

        menu.hidden = false;
        const menuH = menu.offsetHeight;
        const spaceBelow = innerHeight - r.bottom - 20;
        if (menuH > spaceBelow && r.top > menuH + 30) {
            menu.style.top = Math.round(r.top - menuH - 8) + 'px';
        }
    }

    function build(select) {
        const wrap = document.createElement('div');
        wrap.className = 'gselect';
        if (select.dataset.grow) wrap.style.flex = '1 1 190px';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gselect-btn';
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML = `<span>${select.options[select.selectedIndex].textContent}</span>${CHEVRON}`;

        wrap.appendChild(btn);
        select.after(wrap);
        select.dataset.replaced = '1';
        select.style.display = 'none';

        btn.addEventListener('click', () => {
            if (openWrap === wrap) { close(); return; }
            close();
            openWrap = wrap;
            wrap.classList.add('open');
            btn.setAttribute('aria-expanded', 'true');

            menu.innerHTML = '';
            [...select.options].forEach((opt, i) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'gselect-item' + (i === select.selectedIndex ? ' is-active' : '');
                item.setAttribute('role', 'option');
                item.textContent = opt.textContent;
                item.addEventListener('click', () => {
                    select.selectedIndex = i;
                    btn.querySelector('span').textContent = opt.textContent;
                    menu.querySelectorAll('.gselect-item').forEach((el, j) => el.classList.toggle('is-active', j === i));
                    close();
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                });
                menu.appendChild(item);
            });

            place(btn);
            menu.classList.add('is-open');
            const active = menu.querySelector('.is-active') || menu.firstElementChild;
            if (active) active.scrollIntoView({ block: 'nearest' });
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!document.querySelector('select')) return;
        menu = document.createElement('div');
        menu.className = 'gselect-menu glass';
        menu.setAttribute('role', 'listbox');
        menu.hidden = true;
        document.body.appendChild(menu);
        document.querySelectorAll('select').forEach(build);

        addEventListener('scroll', () => { if (openWrap) place(openWrap.querySelector('.gselect-btn')); }, true);
        addEventListener('resize', () => { if (openWrap) place(openWrap.querySelector('.gselect-btn')); });
    });

    addEventListener('click', e => {
        if (!openWrap) return;
        if (e.target.closest('.gselect') || e.target.closest('.gselect-menu')) return;
        close();
    });
    addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
})();
