import { setContent, q, qAll } from "./utilities/tools.js";
import { initRouter, navigateTo } from "./utilities/router.js";
import { dashboard } from "./pages/dashboard.js";
import { inbound, hasUnsubmitted as inboundUnsubmitted } from "./pages/Inbound.js";
import { bintobin } from "./pages/bintobin.js";
import { outbound, hasUnsubmitted as outboundUnsubmitted } from "./pages/outbound.js";
import { retur, hasUnsubmitted as returUnsubmitted } from "./pages/retur.js";
import { transactions } from "./pages/transactions.js";
import { stock } from "./pages/stock.js";
import { material } from "./pages/material.js";
import { users, showChangePasswordPopup } from "./pages/users.js";
import { fetchCurrentUser, showLoginScreen, onUserChange, logout, canOpen, onNewVersion, checkForNewVersion } from "./utilities/auth.js";
import { toast } from "./utilities/toast.js";
import { confirmDialog } from "./utilities/popups.js";
import { initScanButtons } from "./utilities/scanner.js";
import { initBinPickerButtons } from "./utilities/binPicker.js";

const app = document.getElementById('app');

// Menu navbar per kelompok (antar kelompok dipisah garis).
// [nama menu, teks, ikon]. Nama menu = data-page = nama di ROLE_PAGES (config/helper.php).
// Ikon = nama data-icon di public/icons.css.
const MENU_GROUPS = [
    [['dashboard', 'Dashboard', 'grid']],
    [['inbound', 'Inbound', 'inbound'], ['outbound', 'Outbound', 'outbound'], ['bintobin', 'Bin to Bin', 'swap'], ['retur', 'Retur', 'undo']],
    [['transactions', 'Histori Transaksi', 'history'], ['stock', 'Stock Overview', 'package']],
    [['material', 'Material', 'tag'], ['user', 'User', 'users']],
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

// --- Pembaruan aplikasi -------------------------------------------------------------------
// Setelah file tampilan di server diperbarui, tab yang masih terbuka di HP tetap menjalankan
// kode lama sampai dimuat ulang. auth.js memberi tahu lewat onNewVersion(); di sini diputuskan
// KAPAN dimuat ulang: otomatis, tapi hanya di saat aman, yaitu
//   - saat pindah menu, atau
//   - saat operator kembali ke aplikasi (dari aplikasi lain / layar HP menyala lagi),
// dan selama tidak ada daftar yang belum di-Submit (isinya hanya di memori, hilang kalau
// dimuat ulang). Selama belum aman, banner "Versi baru" tampil dengan tombol Muat ulang.

let updateAvailable = false;

// Daftar yang belum di-Submit di halaman MANA PUN, bukan hanya yang sedang tampil:
// daftar Inbound tetap tersimpan walau operator sedang membuka menu lain.
function hasUnsubmittedList(){
    return inboundUnsubmitted() || outboundUnsubmitted() || returUnsubmitted();
}

// Isian form yang sudah diketik di halaman yang tampil (filter tidak dihitung).
function hasTypedInput(){
    return [...qAll('#content-area .card:not(.filter-bar) input')]
        .some(input => !input.disabled && input.type !== 'checkbox' && input.type !== 'radio' && input.value.trim() !== '');
}

function handleNewVersion(){
    if (updateAvailable) return; // terpanggil di setiap respons, cukup sekali
    updateAvailable = true;
    q('#update-banner').hidden = false;
}

// Kembali ke aplikasi: cek versi dulu (selama aplikasi di belakang tidak ada request), lalu muat
// ulang kalau aman. Isian form yang sudah diketik juga dijaga, karena operator mungkin hanya
// sebentar membuka aplikasi lain di tengah mengisi form.
async function handleVisibilityChange(){
    if (document.visibilityState !== 'visible') return;

    await checkForNewVersion();
    if (updateAvailable && !hasUnsubmittedList() && !hasTypedInput()) location.reload();
}

// Tombol Muat ulang di banner: operator sendiri yang memilih, jadi boleh walau ada daftar
// yang belum di-Submit, asal sudah dikonfirmasi.
async function reloadForUpdate(){
    if (hasUnsubmittedList()) {
        const ok = await confirmDialog({
            title: 'Muat ulang sekarang?',
            message: 'Daftar pallet yang belum di-Submit akan hilang.',
            confirmText: 'Muat ulang',
            icon: 'reset',
            danger: true,
        });
        if (!ok) return;
    }
    location.reload();
}

// Banner di antara menu dan isi halaman, di luar #content-area supaya tidak ikut
// terhapus saat pindah halaman. Isinya teks tetap, jadi tidak perlu escapeHtml.
function renderUpdateBanner(){
    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.className = 'update-banner';
    banner.setAttribute('role', 'status');
    banner.hidden = true;
    banner.innerHTML = `
        <span class="update-banner-icon" data-icon="info" aria-hidden="true"></span>
        <p class="update-banner-text">
            <b>Versi baru aplikasi tersedia.</b>
            Dimuat ulang otomatis saat pindah menu, kalau tidak ada daftar yang belum di-Submit.
        </p>
        <button type="button" class="btn-sm btn-primary" data-icon="reset">Muat ulang</button>
    `;
    banner.querySelector('button').addEventListener('click', reloadForUpdate);
    return banner;
}

// Menggambar halaman. Dipanggil oleh router (klik menu, back/forward, refresh).
// params = parameter dari URL, mis. { code: 'RMPMOB26090007' } untuk #retur?code=...,
// atau { item, exp, pallet } untuk #outbound / #bintobin yang dibuka dari Stock Overview.
function renderPage(page, params = {}){
    // Ada versi baru dan pindah menu tidak akan membuang daftar yang belum di-Submit:
    // muat ulang di sini. URL sudah berisi halaman tujuan, jadi yang terbuka tetap halaman itu.
    if (updateAvailable && !hasUnsubmittedList()) {
        location.reload();
        return;
    }

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
        outbound(params);
    } else if(page === 'bintobin'){
        bintobin(params);
    } else if(page === 'retur'){
        retur(params);
    } else if(page === 'transactions'){
        transactions();
    } else if(page === 'stock'){
        stock();
    } else if(page === 'material'){
        material();
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
    app.appendChild(renderUpdateBanner());

    const contentArea = document.createElement('div');
    contentArea.id = 'content-area';
    app.appendChild(contentArea);

    // Menu & nama di navbar ikut berganti kalau login ulang di popup memakai akun lain,
    // atau admin mengubah nama lengkapnya sendiri di menu User.
    onUserChange(handleUserChange);
    handleUserChange(user);

    // Tombol scan kamera & Pilih Bin di samping input (di halaman mana pun) ditangani di sini sekali.
    initScanButtons();
    initBinPickerButtons();

    // Aplikasi diperbarui di server saat tab ini masih terbuka (lihat "Pembaruan aplikasi" di atas).
    onNewVersion(handleNewVersion);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Halaman awal diambil dari URL, jadi setelah login operator langsung ke halaman
    // yang tadi dibuka (mis. #retur?code=...).
    initRouter(renderPage);
}

initApp();
