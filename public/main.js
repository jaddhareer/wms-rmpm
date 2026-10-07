import { setContent } from "./utilities/tools.js";
import { initRouter, navigateTo } from "./utilities/router.js";
import { dashboard } from "./pages/dashboard.js";
import { inbound } from "./pages/Inbound.js";
import { bintobin } from "./pages/bintobin.js";
import { outbound } from "./pages/outbound.js";
import { retur } from "./pages/retur.js";
import { transactions } from "./pages/transactions.js";
import { stock } from "./pages/stock.js";
import { fetchCurrentUser, showLoginScreen, onUserChange, logout } from "./utilities/auth.js";

const app = document.getElementById('app');

function renderNavbar(){
    const nav = document.createElement('nav');
    nav.innerHTML = `
        <button class="nav-btn" data-page="dashboard">Dashboard</button><hr>
        <button class="nav-btn" data-page="inbound">Inbound</button>
        <button class="nav-btn" data-page="outbound">Outbound</button>
        <button class="nav-btn" data-page="bintobin">Bin to Bin</button>
        <button class="nav-btn" data-page="retur">Retur</button><hr>
        <button class="nav-btn" data-page="transactions">Histori Transaksi</button>
        <button class="nav-btn" data-page="stock">Stock Overview</button><hr>
        <button class="nav-btn" data-page="user">User</button><hr>
        <span id="nav-user"></span>
        <button id="btn-logout">Logout</button>
    `;

    nav.querySelectorAll('.nav-btn').forEach(menu => {
        menu.addEventListener('click', (e) => {
            navigateTo(e.target.getAttribute('data-page'));
        })
    })

    nav.querySelector('#btn-logout').addEventListener('click', handleLogout);

    return nav;
}

// Nama user yang sedang login di navbar.
// textContent (bukan innerHTML), jadi aman tanpa escapeHtml.
function renderUserInfo(user){
    const el = document.getElementById('nav-user');
    if (el) el.textContent = user ? `${user.full_name || user.username} (${user.role})` : '';
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
        setContent(`<h1>INI HALAMAN user</h1>`)
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

    // Nama di navbar ikut berganti kalau login ulang di popup memakai akun lain.
    onUserChange(renderUserInfo);
    renderUserInfo(user);

    // Halaman awal diambil dari URL, jadi setelah login operator langsung ke halaman
    // yang tadi dibuka (mis. #retur?code=...).
    initRouter(renderPage);
}

initApp();
