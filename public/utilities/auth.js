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

const LOGIN_STYLE = `
    <style>
        .login-screen { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f2f2f0; }
        .login-form { background: #fff; padding: 24px; width: 300px; max-width: 100%; box-sizing: border-box; border: 1px solid #ddd; }
        .login-form h2 { margin: 0 0 12px; }
        .login-form label { display: block; margin-bottom: 10px; }
        .login-form input { display: block; width: 100%; box-sizing: border-box; padding: 6px; margin-top: 4px; }
        .login-message { margin: 0 0 12px; color: #52514e; }
        .login-error { min-height: 1.2em; margin: 0 0 10px; color: #c62828; }
        .login-actions { display: flex; gap: 8px; }
        .relogin-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: flex;
                           align-items: center; justify-content: center; z-index: 2000; }
    </style>
`;

// Isinya teks tetap dari kode (bukan data user), jadi tidak perlu escapeHtml.
function loginFormHtml(message = '', cancelable = false){
    return `
        <form class="login-form">
            <h2>WMS RMPM</h2>
            ${message ? `<p class="login-message">${message}</p>` : ''}
            <label>Username
                <input name="username" autocomplete="username" required>
            </label>
            <label>Password
                <input name="password" type="password" autocomplete="current-password" required>
            </label>
            <p class="login-error"></p>
            <div class="login-actions">
                <button type="submit">Login</button>
                ${cancelable ? '<button type="button" class="login-cancel">Batal</button>' : ''}
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
    container.innerHTML = LOGIN_STYLE + `<div class="login-screen">${loginFormHtml()}</div>`;

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
    overlay.innerHTML = LOGIN_STYLE + loginFormHtml(
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
