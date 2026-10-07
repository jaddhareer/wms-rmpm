<?php

// Login & sesi user. Nanti User Management juga masuk ke controller ini.
//   POST ?action=login    body JSON { "username": "...", "password": "..." }
//   POST ?action=logout
//   GET  ?action=me       -> user yang sedang login, atau user: null kalau belum login
//
// Berbeda dengan controller lain yang berupa script biasa, controller ini berbentuk class:
// satu method per aksi, dan potongan kode di paling bawah memilih method mana yang dijalankan.

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

class UsersController {
    private $users;

    public function __construct(PDO $conn) {
        $this->users = new UsersModel($conn);
    }

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

        beginUserSession((int) $user['id']);

        jsonResponse(['success' => true, 'user' => $this->publicUser($user)]);
    }

    public function logout(): void {
        endSession();
        jsonResponse(['success' => true]);
    }

    // "Belum login" adalah jawaban yang sah untuk pertanyaan "siapa saya?", bukan error.
    // Jadi dibalas 200 + user null (bukan 401), supaya membuka layar login tidak
    // memunculkan error merah di console browser.
    public function me(): void {
        $userId = currentUserId();
        $user = $userId === null ? false : $this->users->findById($userId);

        // Sesi masih ada, tapi user-nya sudah tidak ada di database -> anggap belum login.
        if ($userId !== null && !$user) {
            endSession();
        }

        jsonResponse(['success' => true, 'user' => $user ? $this->publicUser($user) : null]);
    }

    // Hanya kolom yang aman dikirim ke browser. password_hash TIDAK PERNAH ikut.
    private function publicUser(array $user): array {
        return [
            'id'        => (int) $user['id'],
            'username'  => $user['username'],
            'full_name' => $user['full_name'],
            'role'      => $user['role'],
        ];
    }
}

$db = new Database();
$controller = new UsersController($db->getConnection());

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// Setiap method di atas selalu diakhiri jsonResponse() (exit), jadi baris paling bawah
// hanya tercapai kalau aksi/method-nya tidak cocok.
if ($action === 'login' && $method === 'POST') {
    $controller->login();
} elseif ($action === 'logout' && $method === 'POST') {
    $controller->logout();
} elseif ($action === 'me' && $method === 'GET') {
    $controller->me();
}

jsonResponse(['success' => false, 'error' => 'Aksi tidak dikenal'], 404);
