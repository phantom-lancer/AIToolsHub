function showToast(msg) {
    let box = document.getElementById('toast');
    if (!box) {
        box = document.createElement('div');
        box.id = 'toast';
        document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'toast-msg';
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 450); }, 2600);
}
