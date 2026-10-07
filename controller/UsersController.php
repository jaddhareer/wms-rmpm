<?php

// Login, sesi, dan User Management.
//
//   Semua user yang login:
//     POST ?action=login            { "username", "password" }
//     POST ?action=logout
//     GET  ?action=me               -> user yang sedang login (+ menu yang boleh), atau user: null
//     POST ?action=change_password  { "old_password", "new_password" }
//
//   Khusus role yang punya menu 'user' (admin, lihat ROLE_PAGES di helper.php):
//     GET  ?action=list             -> semua user + daftar role
//     POST ?action=create           { "username", "full_name", "role", "password" }
//     POST ?action=update           { "id", "full_name", "role" }
//     POST ?action=set_active       { "id", "is_active": true/false }
//     POST ?action=reset_password   { "id", "password" }
//
// Berbeda dengan controller lain yang berupa script biasa, controller ini berbentuk class:
// satu method per aksi, dan tabel $routes di paling bawah memilih method mana yang dijalankan.
//
// PENTING: error di sini jangan pernah dibalas 401, kecuali "belum login". Bagi apiFetch()
// di browser, 401 artinya "sesi habis" dan akan memunculkan popup login ulang.

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

class UsersController {
    private $conn;
    private $users;

    public function __construct(PDO $conn) {
        $this->conn  = $conn;
        $this->users = new UsersModel($conn);
    }

    // =========================================================
    // Login & sesi (semua user)
    // =========================================================

    public function login(): void {
        $data = readJsonBody();

        $username = sanitize($data['username'] ?? '');
        // Password TIDAK di-trim: spasi di awal/akhir bisa jadi bagian dari password.
        $password = (string) ($data['password'] ?? '');

        if ($username === '' || $password === '') {
            jsonResponse(['success' => false, 'error' => 'Username dan password wajib diisi'], 400);
        }

        $user = $this->users->findByUsername($username);

        // Pesannya sengaja sama untuk "username tidak ada" dan "password salah",
        // supaya orang tidak bisa menebak username mana yang terdaftar.
        if (!$user || !password_verify($password, $user['password_hash'])) {
            jsonResponse(['success' => false, 'error' => 'Username atau password salah'], 401);
        }

        // Dicek SETELAH password benar: orang yang tidak tahu password tidak bisa
        // mengetahui apakah sebuah akun sudah dinonaktifkan.
        if (!(int) $user['is_active']) {
            jsonResponse(['success' => false, 'error' => 'Akun ini sudah dinonaktifkan, hubungi admin'], 403);
        }

        beginUserSession((int) $user['id']);

        jsonResponse(['success' => true, 'user' => $this->sessionUser($user)]);
    }

    public function logout(): void {
        endSession();
        jsonResponse(['success' => true]);
    }

    // "Belum login" adalah jawaban yang sah untuk pertanyaan "siapa saya?", bukan error.
    // Jadi dibalas 200 + user null (bukan 401), supaya membuka layar login tidak
    // memunculkan error merah di console browser.
    public function me(): void {
        $user = currentUser(); // sudah mengecek sesi + user masih aktif

        jsonResponse(['success' => true, 'user' => $user ? $this->sessionUser($user) : null]);
    }

    public function changePassword(): void {
        $userId = requireLogin();
        $data = readJsonBody();

        $oldPassword = (string) ($data['old_password'] ?? '');
        $newPassword = (string) ($data['new_password'] ?? '');

        if (!password_verify($oldPassword, (string) $this->users->findPasswordHash($userId))) {
            throw new Exception('Password lama salah');
        }
        $this->validatePassword($newPassword);

        $this->users->setPasswordHash($userId, password_hash($newPassword, PASSWORD_DEFAULT));

        // ID sesi baru: kalau ada orang lain yang sempat memegang ID sesi lama, dia ikut terputus.
        beginUserSession($userId);

        jsonResponse(['success' => true]);
    }

    // =========================================================
    // User Management (hanya role yang punya menu 'user')
    // =========================================================

    public function listUsers(): void {
        requireLogin('user');

        jsonResponse([
            'success' => true,
            'data'    => array_map(fn($user) => $this->publicUser($user), $this->users->findAll()),
            'roles'   => array_keys(ROLE_PAGES), // pilihan role di form, satu sumber dengan hak akses
        ]);
    }

    public function create(): void {
        requireLogin('user');
        $data = readJsonBody();

        $username = strtolower(sanitize($data['username'] ?? ''));
        $fullName = sanitize($data['full_name'] ?? '');
        $role     = sanitize($data['role'] ?? '');
        $password = (string) ($data['password'] ?? '');

        // Tanpa spasi & huruf besar: mudah diketik di HP/scanner dan tidak ada username
        // "Budi" dan "budi" yang terlihat seperti dua orang berbeda.
        if (!preg_match('/^[a-z0-9._-]{3,50}$/', $username)) {
            throw new Exception('Username 3-50 karakter: huruf kecil, angka, titik, garis bawah, atau strip');
        }
        $this->validateProfile($fullName, $role);
        $this->validatePassword($password);

        try {
            $id = $this->users->create($username, $fullName, $role, password_hash($password, PASSWORD_DEFAULT));
        } catch (PDOException $e) {
            // 1062 = melanggar UNIQUE index. Username kembar dicek oleh database, bukan dengan
            // SELECT dulu, supaya dua admin yang membuat username sama di detik yang sama
            // tetap ditolak salah satunya.
            if (($e->errorInfo[1] ?? null) === 1062) {
                throw new Exception("Username $username sudah dipakai");
            }
            throw $e;
        }

        jsonResponse(['success' => true, 'id' => $id]);
    }

    public function update(): void {
        $adminId = requireLogin('user');
        $data = readJsonBody();

        $target   = $this->findTarget($data);
        $targetId = (int) $target['id'];
        $fullName = sanitize($data['full_name'] ?? '');
        $role     = sanitize($data['role'] ?? '');

        $this->validateProfile($fullName, $role);

        // Mencegah admin mengunci dirinya sendiri di luar menu User.
        if ($targetId === $adminId && $role !== $target['role']) {
            throw new Exception('Tidak bisa mengubah role akun sendiri');
        }

        $this->conn->beginTransaction();

        if ($target['role'] === 'admin' && $role !== 'admin') {
            $this->ensureAnotherAdmin($targetId);
        }
        $this->users->update($targetId, $fullName, $role);

        $this->conn->commit();

        jsonResponse(['success' => true]);
    }

    // User yang dinonaktifkan langsung terputus: request berikutnya ditolak currentUser().
    public function setActive(): void {
        $adminId = requireLogin('user');
        $data = readJsonBody();

        $target   = $this->findTarget($data);
        $targetId = (int) $target['id'];
        // FILTER_VALIDATE_BOOLEAN: true/"1"/"true" -> true. (bool) "false" justru true.
        $active = filter_var($data['is_active'] ?? false, FILTER_VALIDATE_BOOLEAN);

        if (!$active && $targetId === $adminId) {
            throw new Exception('Tidak bisa menonaktifkan akun sendiri');
        }

        $this->conn->beginTransaction();

        if (!$active && $target['role'] === 'admin') {
            $this->ensureAnotherAdmin($targetId);
        }
        $this->users->setActive($targetId, $active);

        $this->conn->commit();

        jsonResponse(['success' => true]);
    }

    public function resetPassword(): void {
        requireLogin('user');
        $data = readJsonBody();

        $target   = $this->findTarget($data);
        $password = (string) ($data['password'] ?? '');

        $this->validatePassword($password);

        $this->users->setPasswordHash((int) $target['id'], password_hash($password, PASSWORD_DEFAULT));

        jsonResponse(['success' => true]);
    }

    // =========================================================
    // Bantuan
    // =========================================================

    // User yang mau diubah, dari "id" di body.
    private function findTarget(array $data): array {
        $user = $this->users->findById((int) ($data['id'] ?? 0));

        if (!$user) {
            throw new Exception('User tidak ditemukan');
        }
        return $user;
    }

    private function validateProfile(string $fullName, string $role): void {
        if ($fullName === '' || mb_strlen($fullName) > 100) {
            throw new Exception('Nama lengkap wajib diisi (maksimal 100 karakter)');
        }
        if (!isset(ROLE_PAGES[$role])) {
            throw new Exception("Role tidak dikenal: $role");
        }
    }

    private function validatePassword(string $password): void {
        $error = passwordError($password);
        if ($error !== null) {
            throw new Exception($error);
        }
    }

    // Wajib dipanggil di dalam beginTransaction(): countActiveAdminsExcept() memakai FOR UPDATE.
    // Tanpa pengecekan di database ini, dua admin yang saling menurunkan role di detik yang
    // sama sama-sama lolos (masing-masing masih melihat admin lain), lalu admin habis.
    private function ensureAnotherAdmin(int $userId): void {
        if ($this->users->countActiveAdminsExcept($userId) === 0) {
            throw new Exception('Harus tersisa minimal satu admin aktif');
        }
    }

    // Data user untuk browser. password_hash TIDAK PERNAH ikut.
    private function publicUser(array $user): array {
        return [
            'id'         => (int) $user['id'],
            'username'   => $user['username'],
            'full_name'  => $user['full_name'],
            'role'       => $user['role'],
            'is_active'  => (bool) (int) $user['is_active'],
            'created_at' => $user['created_at'],
        ];
    }

    // Untuk login & me: ditambah daftar menu yang boleh dibuka (dipakai navbar).
    private function sessionUser(array $user): array {
        return $this->publicUser($user) + ['pages' => ROLE_PAGES[$user['role']] ?? []];
    }
}

$db = new Database();
$conn = $db->getConnection();
$controller = new UsersController($conn);

// Tabel rute: method HTTP + ?action= -> nama method di class.
// Aksi yang mengubah data hanya bisa lewat POST.
$routes = [
    'GET' => [
        'me'   => 'me',
        'list' => 'listUsers',
    ],
    'POST' => [
        'login'           => 'login',
        'logout'          => 'logout',
        'change_password' => 'changePassword',
        'create'          => 'create',
        'update'          => 'update',
        'set_active'      => 'setActive',
        'reset_password'  => 'resetPassword',
    ],
];

$handler = $routes[$_SERVER['REQUEST_METHOD']][sanitize($_GET['action'] ?? '')] ?? null;

if ($handler === null) {
    jsonResponse(['success' => false, 'error' => 'Aksi tidak dikenal'], 404);
}

// Setiap method selalu diakhiri jsonResponse() (exit). Pelanggaran aturan dilempar sebagai
// Exception dan ditangkap di sini: rollBack dulu, baru jsonResponse (karena jsonResponse exit).
try {
    $controller->$handler(); // nama method diambil dari variabel, mis. $controller->create()
} catch (Exception $e) {
    if ($conn->inTransaction()) {
        $conn->rollBack();
    }
    jsonResponse(['success' => false, 'error' => $e->getMessage()], 400);
}
