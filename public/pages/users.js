import { setContent, q, escapeHtml } from "../utilities/tools.js";
import { apiFetch, getCurrentUser, fetchCurrentUser } from "../utilities/auth.js";
import { openPopup, closePopup } from "../utilities/popups.js";

// User Management (menu "User", hanya admin) + popup Ganti Password (semua user, dari navbar).
//
// Semua aturan (siapa boleh apa, admin tidak bisa menonaktifkan diri sendiri, minimal satu
// admin aktif, panjang password, username kembar) dicek di SERVER. Di sini tombol hanya
// disembunyikan supaya orang tidak mencoba sesuatu yang pasti ditolak.

const API = 'controller/UsersController.php';

// State halaman ini (scope modul).
let usersList = [];  // daftar user dari server
let roles = [];      // pilihan role, dari server (ROLE_PAGES) supaya satu sumber dengan hak akses
let requestId = 0;   // penanda jawaban basi

export function users(){
    setContent(`
        <h2>User Management</h2>
        <button type="button" id="btn-add-user">Tambah User</button>
        <p id="user-info">Memuat...</p>
        <table border="1">
            <thead>
                <tr><th>Username</th><th>Nama Lengkap</th><th>Role</th><th>Status</th><th>Dibuat</th><th>Aksi</th></tr>
            </thead>
            <tbody id="user-body"></tbody>
        </table>
    `);

    q('#btn-add-user').addEventListener('click', () => showUserForm(null));

    // Event delegation: tombol aksi di setiap baris dibuat ulang setiap render.
    q('#user-body').addEventListener('click', (e) => {
        const button = e.target.closest('button[data-action]');
        if (!button) return;

        const user = usersList.find(u => u.id === Number(button.dataset.id));
        if (!user) return;

        if (button.dataset.action === 'edit') showUserForm(user);
        else if (button.dataset.action === 'reset') showResetPassword(user);
        else if (button.dataset.action === 'toggle') toggleActive(user);
    });

    loadUsers();
}

async function loadUsers(){
    const myRequest = ++requestId;

    try {
        const res = await apiFetch(`${API}?action=list`);
        const result = await res.json();

        // Jawaban basi: sudah ada request yang lebih baru, atau sudah pindah menu.
        if (myRequest !== requestId || !q('#user-body')) return;

        if (!result.success) {
            q('#user-info').textContent = 'Gagal memuat data: ' + result.error;
            return;
        }

        usersList = result.data;
        roles = result.roles;
        renderRows();

    } catch (err) {
        if (myRequest !== requestId || !q('#user-info')) return;
        q('#user-info').textContent = 'Tidak bisa menghubungi server: ' + err.message;
    }
}

function renderRows(){
    const myId = getCurrentUser()?.id;
    const activeCount = usersList.filter(u => u.is_active).length;

    q('#user-info').textContent = `${usersList.length} user (${activeCount} aktif)`;

    q('#user-body').innerHTML = usersList.map(user => {
        const isMe = user.id === myId;
        const id = escapeHtml(user.id);

        // Akun sendiri tidak punya tombol Nonaktifkan (server juga menolaknya).
        return `
            <tr style="${user.is_active ? '' : 'color:#898781'}">
                <td>${escapeHtml(user.username)}${isMe ? ' <b>(Anda)</b>' : ''}</td>
                <td>${escapeHtml(user.full_name)}</td>
                <td>${escapeHtml(user.role)}</td>
                <td>${user.is_active ? 'Aktif' : 'Nonaktif'}</td>
                <td>${escapeHtml(user.created_at)}</td>
                <td>
                    <button type="button" data-action="edit" data-id="${id}">Edit</button>
                    <button type="button" data-action="reset" data-id="${id}">Reset Password</button>
                    ${isMe ? '' : `<button type="button" data-action="toggle" data-id="${id}">${user.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>`}
                </td>
            </tr>
        `;
    }).join('');
}

// =========================================================
// Popup form
// =========================================================

// Input password baru + ulangannya. Nama input selalu "password" & "password_confirm",
// supaya bindPopupForm() bisa mencocokkan keduanya di semua form.
function passwordFieldsHtml(label){
    return `
        <label>${label}<br><input name="password" type="password" required autocomplete="new-password"></label><br>
        <label>Ulangi ${label.toLowerCase()}<br><input name="password_confirm" type="password" required autocomplete="new-password"></label><br>
    `;
}

const FORM_BUTTONS = `
    <p class="form-error" style="color:#c62828"></p>
    <button type="submit">Simpan</button>
    <button type="button" class="btn-cancel">Batal</button>
`;

// POST ke UsersController. Melempar Error berisi pesan dari server kalau gagal.
async function postAction(action, body){
    const res = await apiFetch(`${API}?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.success) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

// Pasang perilaku form di dalam popup:
//   buildRequest(elements) -> [action, body] yang dikirim ke server
//   onSuccess()            -> dipanggil setelah berhasil (popup sudah ditutup)
// Kalau gagal, pesan error tampil DI POPUP dan isi form tidak hilang, jadi operator
// tinggal membetulkan isian yang salah.
function bindPopupForm(box, buildRequest, onSuccess){
    const form = box.querySelector('form');
    const errorBox = form.querySelector('.form-error');
    const button = form.querySelector('button[type="submit"]');

    box.querySelector('.btn-cancel').addEventListener('click', closePopup);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.textContent = '';

        const f = form.elements;
        if (f.password_confirm && f.password.value !== f.password_confirm.value) {
            errorBox.textContent = 'Ulangan password tidak sama';
            f.password_confirm.focus();
            return;
        }

        button.disabled = true; // cegah submit dobel
        try {
            const [action, body] = buildRequest(f);
            await postAction(action, body);
            closePopup();
            onSuccess();
        } catch (err) {
            errorBox.textContent = err.message; // textContent: aman tanpa escapeHtml
        } finally {
            button.disabled = false;
        }
    });
}

// Tambah User (user = null) atau Edit User.
function showUserForm(user){
    const isNew = user === null;
    const isMe = !isNew && user.id === getCurrentUser()?.id;

    // User baru WAJIB memilih role sendiri (tidak ada pilihan default), supaya tidak ada
    // akun yang tidak sengaja dibuat sebagai admin.
    const roleOptions = (isNew ? '<option value="">-- pilih role --</option>' : '')
        + roles.map(r => `<option value="${escapeHtml(r)}" ${r === user?.role ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('');

    const box = openPopup(`
        <h3>${isNew ? 'Tambah User' : 'Edit User'}</h3>
        <form>
            <label>Username<br>
                ${isNew
                    ? '<input name="username" required maxlength="50" autocomplete="off">'
                    : `<input value="${escapeHtml(user.username)}" disabled>`}
            </label><br>
            ${isNew ? '<small>Huruf kecil, angka, titik, garis bawah, strip. Tidak bisa diubah setelah dibuat.</small><br>' : ''}
            <label>Nama Lengkap<br>
                <input name="full_name" required maxlength="100" value="${escapeHtml(user?.full_name)}">
            </label><br>
            <label>Role<br>
                <select name="role" required ${isMe ? 'disabled' : ''}>${roleOptions}</select>
            </label><br>
            ${isMe ? '<small>Role akun sendiri tidak bisa diubah.</small><br>' : ''}
            ${isNew ? passwordFieldsHtml('Password') : ''}
            ${FORM_BUTTONS}
        </form>
    `);

    box.querySelector(isNew ? '[name="username"]' : '[name="full_name"]').focus();

    bindPopupForm(box,
        (f) => isNew
            ? ['create', {
                username:  f.username.value.trim(),
                full_name: f.full_name.value.trim(),
                role:      f.role.value,
                password:  f.password.value,
            }]
            : ['update', {
                id:        user.id,
                full_name: f.full_name.value.trim(),
                role:      f.role.value, // select disabled (akun sendiri) tetap terbaca nilainya
            }],
        () => {
            loadUsers();
            // Mengubah nama sendiri -> nama di navbar ikut diperbarui.
            if (isMe) fetchCurrentUser();
        }
    );
}

function showResetPassword(user){
    const box = openPopup(`
        <h3>Reset Password: ${escapeHtml(user.username)}</h3>
        <form>
            ${passwordFieldsHtml('Password baru')}
            ${FORM_BUTTONS}
        </form>
    `);

    box.querySelector('[name="password"]').focus();

    bindPopupForm(box,
        (f) => ['reset_password', { id: user.id, password: f.password.value }],
        () => alert(`Password ${user.username} sudah di-reset. Beritahukan password baru ke yang bersangkutan.`)
    );
}

async function toggleActive(user){
    const activate = !user.is_active;
    const question = activate
        ? `Aktifkan kembali user ${user.username}?`
        : `Nonaktifkan user ${user.username}?\n\nDia tidak bisa login lagi dan sesinya langsung terputus. Riwayat transaksinya tetap ada.`;

    if (!confirm(question)) return;

    try {
        await postAction('set_active', { id: user.id, is_active: activate });
        loadUsers();
    } catch (err) {
        alert('Gagal: ' + err.message);
    }
}

// Ganti password sendiri. Dibuka dari tombol "Ganti Password" di navbar (semua role),
// jadi tidak bergantung pada halaman User Management.
export function showChangePasswordPopup(){
    const box = openPopup(`
        <h3>Ganti Password</h3>
        <form>
            <label>Password lama<br><input name="old_password" type="password" required autocomplete="current-password"></label><br>
            ${passwordFieldsHtml('Password baru')}
            ${FORM_BUTTONS}
        </form>
    `);

    box.querySelector('[name="old_password"]').focus();

    bindPopupForm(box,
        (f) => ['change_password', { old_password: f.old_password.value, new_password: f.password.value }],
        () => alert('Password berhasil diganti')
    );
}
