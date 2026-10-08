import { setContent, q, qAll } from "./utilities/tools.js";
import { initRouter, navigateTo } from "./utilities/router.js";
import { dashboard } from "./pages/dashboard.js";
import { inbound } from "./pages/Inbound.js";
import { bintobin } from "./pages/bintobin.js";
import { outbound } from "./pages/outbound.js";
import { retur } from "./pages/retur.js";
import { transactions } from "./pages/transactions.js";
import { stock } from "./pages/stock.js";
import { users, showChangePasswordPopup } from "./pages/users.js";
import { fetchCurrentUser, showLoginScreen, onUserChange, logout, canOpen } from "./utilities/auth.js";
import { toast } from "./utilities/toast.js";
import { confirmDialog } from "./utilities/popups.js";

const app = document.getElementById('app');

// Menu navbar per kelompok (antar kelompok dipisah garis).
// [nama menu, teks, ikon]. Nama menu = data-page = nama di ROLE_PAGES (config/helper.php).
// Ikon = nama data-icon di public/icons.css.
const MENU_GROUPS = [
    [['dashboard', 'Dashboard', 'grid']],
    [['inbound', 'Inbound', 'inbound'], ['outbound', 'Outbound', 'outbound'], ['bintobin', 'Bin to Bin', 'swap'], ['retur', 'Retur', 'undo']],
    [['transactions', 'Histori Transaksi', 'history'], ['stock', 'Stock Overview', 'package']],
    [['user', 'User', 'users']],
];
const MENU_PAGES = MENU_GROUPS.flat().map(([page]) => page);

// Halaman yang sedang tampil, untuk menandai menunya (warna aksen).
let activePage = null;

// Menu samping. Di layar lebar selalu tampil di kiri. Di layar kecil (< 1024px, lihat
// style.css) disembunyikan dan dibuka lewat tombol ☰ di baris atas (.topbar).
function renderNavbar(){
    const nav = document.createElement('nav');
    nav.className = 'sidebar';
    nav.innerHTML = `
        <div class="topbar">
            <button type="button" class="nav-toggle" data-icon="menu" aria-label="Buka menu" aria-expanded="false" aria-controls="nav-panel"></button>
            <span class="nav-brand">WMS <b>RMPM</b></span>
        </div>
        <div class="nav-panel" id="nav-panel">
            <div class="nav-brand">WMS <b>RMPM</b></div>
            <div id="nav-menu"></div>
            <div class="nav-footer">
                <div class="nav-profile">
                    <span class="nav-avatar" data-icon="user" aria-hidden="true"></span>
                    <span class="nav-profile-text">
                        <span id="nav-user-name"></span>
                        <span id="nav-user-role"></span>
                    </span>
                </div>
                <button type="button" id="btn-password" data-icon="key">Ganti Password</button>
                <button type="button" id="btn-logout" class="btn-logout" data-icon="logout">Logout</button>
            </div>
        </div>
        <div class="nav-backdrop"></div>
    `;

    // Event delegation: tombol menu digambar ulang kalau user berganti (renderMenu),
    // jadi listener dipasang di <nav> yang tetap ada, bukan di tiap tombol.
    nav.addEventListener('click', (e) => {
        if (e.target.closest('.nav-toggle')) {
            setNavOpen(!nav.classList.contains('open'));
            return;
        }

        // Tombol apa pun di menu samping, atau area gelap di luarnya -> laci ditutup (HP).
        if (e.target.closest('.nav-panel button, .nav-backdrop')) setNavOpen(false);

        const menu = e.target.closest('.nav-btn');
        if (menu) {
            navigateTo(menu.dataset.page);
            window.scrollTo(0, 0); // halaman baru mulai dari atas
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setNavOpen(false);
    });

    nav.querySelector('#btn-password').addEventListener('click', showChangePasswordPopup);
    nav.querySelector('#btn-logout').addEventListener('click', handleLogout);

    return nav;
}

// Buka/tutup laci menu di layar kecil. Di layar lebar kelas 'open' tidak berpengaruh.
function setNavOpen(open){
    const nav = q('.sidebar');
    if (!nav) return;

    nav.classList.toggle('open', open);
    nav.querySelector('.nav-toggle').setAttribute('aria-expanded', String(open));
}

// Tombol menu sesuai hak akses user yang login. Kelompok yang kosong (mis. User untuk
// operator) tidak digambar, supaya tidak ada garis pemisah dobel.
// Isinya teks tetap dari MENU_GROUPS (bukan data user), jadi tidak perlu escapeHtml.
function renderMenu(){
    q('#nav-menu').innerHTML = MENU_GROUPS
        .map(group => group.filter(([page]) => canOpen(page)))
        .filter(group => group.length > 0)
        .map(group => `<div class="nav-group">${group
            .map(([page, label, icon]) => `<button type="button" class="nav-btn" data-page="${page}" data-icon="${icon}">${label}</button>`)
            .join('')}</div>`)
        .join('');

    markActiveMenu();
}

// Beri kelas 'active' pada menu halaman yang sedang tampil.
function markActiveMenu(){
    qAll('.nav-btn').forEach(button => {
        const active = button.dataset.page === activePage;
        button.classList.toggle('active', active);
        if (active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    });
}

// Nama & role user yang sedang login di bawah menu samping.
// textContent (bukan innerHTML), jadi aman tanpa escapeHtml.
function renderUserInfo(user){
    const name = document.getElementById('nav-user-name');
    const role = document.getElementById('nav-user-role');
    if (name) name.textContent = user ? (user.full_name || user.username) : '';
    if (role) role.textContent = user ? user.role : '';
}

function handleUserChange(user){
    renderMenu();
    renderUserInfo(user);
}

async function handleLogout(){
    // Konfirmasi dulu: isi form yang belum disimpan ikut hilang.
    const ok = await confirmDialog({
        title: 'Logout dari aplikasi?',
        message: 'Data yang belum disimpan akan hilang.',
        confirmText: 'Logout',
        icon: 'logout',
        danger: true,
    });
    if (!ok) return;

    try {
        await logout();
    } catch (err) {
        toast('Gagal logout: ' + err.message, 'error');
        return;
    }

    // Muat ulang halaman, bukan sekadar menggambar layar login: semua state di modul
    // halaman (daftar pallet Inbound, filter, dsb.) milik user lama ikut terhapus bersih.
    // Setelah reload, initApp() menemukan belum ada sesi dan menampilkan layar login.
    location.reload();
}

// Menggambar halaman. Dipanggil oleh router (klik menu, back/forward, refresh).
// params = parameter dari URL, mis. { code: 'RMPMOB26090007' } untuk #retur?code=...
function renderPage(page, params = {}){
    activePage = page;
    markActiveMenu();

    // Menu yang ada tapi tidak boleh untuk role ini (mis. operator mengetik #user di URL).
    // Ini hanya tampilan: kalau controller-nya tetap dipanggil, server membalas 403.
    if (MENU_PAGES.includes(page) && !canOpen(page)) {
        setContent(`<div class="card"><h2>Tidak punya akses</h2><p class="muted">Menu ini tidak tersedia untuk role Anda.</p></div>`);
        return;
    }

    if(page === 'dashboard'){
        dashboard();
    } else if(page === 'inbound'){
        inbound();
    } else if(page === 'outbound'){
        outbound();
    } else if(page === 'bintobin'){
        bintobin();
    } else if(page === 'retur'){
        retur(params);
    } else if(page === 'transactions'){
        transactions();
    } else if(page === 'stock'){
        stock();
    } else if(page === 'user'){
        users();
    } else {
        setContent(`<div class="card"><h2>Halaman tidak ditemukan</h2></div>`)
    }
}

async function initApp(){
    // Tanya server dulu: apakah browser ini masih punya sesi login?
    let user;
    try {
        user = await fetchCurrentUser();
    } catch (err) {
        app.textContent = 'Tidak bisa menghubungi server: ' + err.message;
        return;
    }

    // Belum login -> layar login, tunggu sampai berhasil. Navbar & halaman belum digambar,
    // jadi tidak ada satu pun request ke controller lain sebelum login.
    if (!user) {
        user = await showLoginScreen(app);
    }

    app.appendChild(renderNavbar());

    const contentArea = document.createElement('div');
    contentArea.id = 'content-area';
    app.appendChild(contentArea);

    // Menu & nama di navbar ikut berganti kalau login ulang di popup memakai akun lain,
    // atau admin mengubah nama lengkapnya sendiri di menu User.
    onUserChange(handleUserChange);
    handleUserChange(user);

    // Halaman awal diambil dari URL, jadi setelah login operator langsung ke halaman
    // yang tadi dibuka (mis. #retur?code=...).
    initRouter(renderPage);
}

initApp();
