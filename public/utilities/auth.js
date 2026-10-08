// Login di sisi browser: layar login, popup login ulang, dan apiFetch().
//
// Sesi login disimpan di SERVER (PHP session). Browser hanya memegang cookie berisi ID
// sesi, yang ikut otomatis di setiap fetch ke server yang sama. Cookie itu HttpOnly
// (tidak bisa dibaca JavaScript), jadi modul ini tidak pernah menyimpan password/token.
//
// Modul ini sengaja TIDAK meng-import tools.js: tools.js yang meng-import modul ini
// (downloadFile memakai apiFetch). Kalau dua-duanya saling import = import melingkar.

const API = 'controller/UsersController.php';

let currentUser = null;         // { id, username, full_name, role, pages: [...] } atau null
let userChangeListener = null;  // dipasang main.js untuk memperbarui nama user di navbar
let reloginPromise = null;      // popup login ulang yang sedang terbuka (dipakai bersama)

// main.js mendaftarkan fungsi yang dipanggil setiap kali user berganti
// (mis. login ulang di popup memakai akun lain).
export function onUserChange(listener){
    userChangeListener = listener;
}

export function getCurrentUser(){
    return currentUser;
}

// true kalau role user yang login boleh membuka menu ini (daftar 'pages' dari server).
// Hanya untuk TAMPILAN (menyembunyikan menu). Penjaga sebenarnya ada di server:
// requireLogin('menu') di controller membalas 403.
export function canOpen(page){
    return currentUser?.pages.includes(page) ?? false;
}

function setCurrentUser(user){
    currentUser = user;
    userChangeListener?.(user);
}

// Tanya server siapa yang sedang login. null = belum login / sesi sudah habis.
export async function fetchCurrentUser(){
    const res = await fetch(`${API}?action=me`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    if (data.user) setCurrentUser(data.user);
    return data.user;
}

async function login(username, password){
    let res;
    try {
        res = await fetch(`${API}?action=login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
    } catch {
        throw new Error('Tidak bisa menghubungi server');
    }

    const data = await res.json().catch(() => ({}));
    if (!data.success) throw new Error(data.error || `HTTP ${res.status}`);

    setCurrentUser(data.user);
    return data.user;
}

export async function logout(){
    const res = await fetch(`${API}?action=logout`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentUser = null;
}

// Pengganti fetch() untuk SEMUA request ke controller yang wajib login.
//
// Kalau server membalas 401 (sesi habis), muncul popup login di atas halaman.
// Setelah login berhasil, request yang sama dikirim ulang dan hasilnya dikembalikan ke
// pemanggil seolah tidak terjadi apa-apa, jadi isi form di halaman tidak hilang.
// Mengirim ulang POST aman: requireLogin() menolak request di baris paling atas
// controller, sebelum ada yang ditulis ke database.
//
// Kalau operator menekan Batal, respons 401 aslinya yang dikembalikan, dan halaman
// menampilkan pesan error-nya seperti error lain.
export async function apiFetch(url, options = {}){
    const res = await fetch(url, options);
    if (res.status !== 401) return res;

    const loggedIn = await askRelogin();
    return loggedIn ? fetch(url, options) : res;
}

// Beberapa request bisa kena 401 bersamaan (mis. autocomplete + simpan).
// Semuanya menunggu SATU popup yang sama, bukan membuka popup bertumpuk.
function askRelogin(){
    if (!reloginPromise) {
        reloginPromise = showReloginPopup().finally(() => { reloginPromise = null; });
    }
    return reloginPromise;
}

// =========================================================
// Tampilan
// =========================================================

// Tampilan layar & popup login diatur di style.css (.login-screen, .login-form, .relogin-overlay).

// Isinya teks tetap dari kode (bukan data user), jadi tidak perlu escapeHtml.
function loginFormHtml(message = '', cancelable = false){
    return `
        <form class="login-form">
            <h2>WMS <b>RMPM</b></h2>
            <p class="login-sub">Warehouse Raw Material &amp; Packaging Material</p>
            ${message ? `<p class="login-message">${message}</p>` : ''}
            <label>Username
                <input name="username" autocomplete="username" required>
            </label>
            <label>Password
                <input name="password" type="password" autocomplete="current-password" required>
            </label>
            <p class="login-error"></p>
            <div class="login-actions">
                <button type="submit" class="btn-primary" data-icon="login">Login</button>
                ${cancelable ? '<button type="button" class="login-cancel" data-icon="x">Batal</button>' : ''}
            </div>
        </form>
    `;
}

// Pasang perilaku submit pada form login. onSuccess(user) dipanggil setelah login berhasil.
function bindLoginForm(form, onSuccess){
    const { username, password } = form.elements;
    const errorBox = form.querySelector('.login-error');
    const button = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.textContent = '';
        button.disabled = true; // cegah login dobel kalau Enter ditekan berkali-kali

        try {
            onSuccess(await login(username.value.trim(), password.value));
        } catch (err) {
            errorBox.textContent = err.message; // textContent: aman tanpa escapeHtml
            password.value = '';
            password.focus();
        } finally {
            button.disabled = false;
        }
    });
}

// Layar login penuh, saat aplikasi dibuka dan belum ada sesi.
// Mengembalikan Promise yang selesai (berisi user) setelah login berhasil.
export function showLoginScreen(container){
    container.innerHTML = `<div class="login-screen">${loginFormHtml()}</div>`;

    const form = container.querySelector('.login-form');
    form.elements.username.focus();

    return new Promise(resolve => {
        bindLoginForm(form, (user) => {
            container.innerHTML = '';
            resolve(user);
        });
    });
}

// Popup login ulang di atas halaman yang sedang dibuka. Selesai dengan true (login
// berhasil) atau false (Batal).
//
// Sengaja tidak memakai openPopup() dari popups.js: openPopup menutup popup lain yang
// sedang terbuka (mis. detail transaksi), padahal request yang kena 401 bisa berasal
// dari popup itu. Overlay ini terpisah dan menumpuk di atasnya (z-index lebih tinggi).
function showReloginPopup(){
    const overlay = document.createElement('div');
    overlay.className = 'relogin-overlay';
    overlay.innerHTML = loginFormHtml(
        'Sesi login habis. Login lagi untuk melanjutkan, isi halaman tidak hilang.',
        true
    );
    document.body.appendChild(overlay);

    const form = overlay.querySelector('.login-form');
    const { username, password } = form.elements;

    // Biasanya operator yang sama: username diisikan, tinggal ketik password.
    // Tetap bisa diganti kalau yang melanjutkan operator lain.
    if (currentUser) {
        username.value = currentUser.username;
        password.focus();
    } else {
        username.focus();
    }

    return new Promise(resolve => {
        const close = (loggedIn) => {
            overlay.remove();
            resolve(loggedIn);
        };
        bindLoginForm(form, () => close(true));
        form.querySelector('.login-cancel').addEventListener('click', () => close(false));
    });
}
