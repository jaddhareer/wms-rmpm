// Notifikasi kecil di bagian atas layar, pengganti alert().
//
// Kenapa bukan alert()? alert() menghentikan halaman sampai tombol OK ditekan. Di gudang
// operator sering langsung scan barang berikutnya; dengan alert, hasil scan itu tertahan
// (atau malah menekan OK) sampai dialognya ditutup. Notifikasi ini tidak menghalangi
// apa pun, bisa ditutup dengan tombol x, dan hilang sendiri.
//
// Pemakaian (type menentukan warna & ikon):
//   toast('Berhasil disimpan: RMPMIB26100003', 'success');
//   toast('Quantity harus lebih dari 0', 'warning');     // isian form belum benar
//   toast('Gagal: ' + data.error, 'error');             // ditolak server / jaringan putus
//   toast('...', 'info');
//
// Modul ini tidak meng-import apa pun, jadi aman di-import dari mana saja.
// Tampilan: #toast-stack dan .toast di style.css.

const ICONS = { success: 'check-circle', error: 'alert-circle', warning: 'alert-triangle', info: 'info' };

// Lama tampil (ms). Error paling lama supaya sempat dibaca. Mouse di atas notifikasi = tidak hilang.
const DURATION = { success: 5000, info: 5000, warning: 5000, error: 8000 };

// Paling banyak sekian notifikasi sekaligus; yang paling lama dibuang.
const MAX_TOASTS = 4;

// Wadah semua notifikasi. Dibuat sekali, saat notifikasi pertama muncul.
// aria-live: pembaca layar ikut membacakan notifikasi baru.
function stack(){
    let el = document.getElementById('toast-stack');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast-stack';
        el.setAttribute('aria-live', 'polite');
        document.body.appendChild(el);
    }
    return el;
}

export function toast(message, type = 'info'){
    if (!ICONS[type]) type = 'info';

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `
        <span class="toast-icon" data-icon="${ICONS[type]}" aria-hidden="true"></span>
        <span class="toast-text"></span>
        <button type="button" class="toast-close" data-icon="x" aria-label="Tutup notifikasi"></button>
    `;
    // textContent (bukan innerHTML): pesan bisa berisi data dari server, jadi aman tanpa escapeHtml.
    el.querySelector('.toast-text').textContent = message;

    // Yang terbaru paling atas.
    const container = stack();
    container.prepend(el);
    while (container.children.length > MAX_TOASTS) {
        container.lastElementChild.remove();
    }

    let timer = null;

    const close = () => {
        clearTimeout(timer);
        el.classList.add('leaving');
        setTimeout(() => el.remove(), 200); // tunggu animasi keluar selesai
    };
    const startTimer = () => {
        clearTimeout(timer);
        timer = setTimeout(close, DURATION[type]);
    };

    el.querySelector('.toast-close').addEventListener('click', close);
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', startTimer);
    startTimer();
}
