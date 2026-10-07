import { setContent, q } from "./utilities/tools.js";
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

const app = document.getElementById('app');

// Menu navbar per kelompok (antar kelompok dipisah garis).
// Nama menu di kiri = data-page = nama di ROLE_PAGES (config/helper.php).
const MENU_GROUPS = [
    [['dashboard', 'Dashboard']],
    [['inbound', 'Inbound'], ['outbound', 'Outbound'], ['bintobin', 'Bin to Bin'], ['retur', 'Retur']],
    [['transactions', 'Histori Transaksi'], ['stock', 'Stock Overview']],
    [['user', 'User']],
];
const MENU_PAGES = MENU_GROUPS.flat().map(([page]) => page);

function renderNavbar(){
    const nav = document.createElement('nav');
    nav.innerHTML = `
        <div id="nav-menu"></div>
        <span id="nav-user"></span>
        <button type="button" id="btn-password">Ganti Password</button>
        <button type="button" id="btn-logout">Logout</button>
    `;

    // Event delegation: tombol menu digambar ulang kalau user berganti (renderMenu),
    // jadi listener dipasang di <nav> yang tetap ada, bukan di tiap tombol.
    nav.addEventListener('click', (e) => {
        const menu = e.target.closest('.nav-btn');
        if (menu) navigateTo(menu.dataset.page);
    });

    nav.querySelector('#btn-password').addEventListener('click', showChangePasswordPopup);
    nav.querySelector('#btn-logout').addEventListener('click', handleLogout);

    return nav;
}

// Tombol menu sesuai hak akses user yang login. Kelompok yang kosong (mis. User untuk
// operator) tidak digambar, supaya tidak ada garis pemisah dobel.
// Isinya teks tetap dari MENU_GROUPS (bukan data user), jadi tidak perlu escapeHtml.
function renderMenu(){
    q('#nav-menu').innerHTML = MENU_GROUPS
        .map(group => group.filter(([page]) => canOpen(page)))
        .filter(group => group.length > 0)
        .map(group => group
            .map(([page, label]) => `<button class="nav-btn" data-page="${page}">${label}</button>`)
            .join('\n'))
        .join('<hr>') + '<hr>';
}

// Nama user yang sedang login di navbar.
// textContent (bukan innerHTML), jadi aman tanpa escapeHtml.
function renderUserInfo(user){
    const el = document.getElementById('nav-user');
    if (el) el.textContent = user ? `${user.full_name || user.username} (${user.role})` : '';
}

function handleUserChange(user){
    renderMenu();
    renderUserInfo(user);
}

async function handleLogout(){
    // Konfirmasi dulu: isi form yang belum disimpan ikut hilang.
    if (!confirm('Logout dari aplikasi? Data yang belum disimpan akan hilang.')) return;

    try {
        await logout();
    } catch (err) {
        alert('Gagal logout: ' + err.message);
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
    // Menu yang ada tapi tidak boleh untuk role ini (mis. operator mengetik #user di URL).
    // Ini hanya tampilan: kalau controller-nya tetap dipanggil, server membalas 403.
    if (MENU_PAGES.includes(page) && !canOpen(page)) {
        setContent(`<h1>Tidak punya akses</h1><p>Menu ini tidak tersedia untuk role Anda.</p>`);
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
        setContent(`<h1>Halaman tidak ditemukan</h1>`)
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
