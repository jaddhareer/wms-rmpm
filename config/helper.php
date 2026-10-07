<?php

// Membersihkan input untuk DISIMPAN: cukup trim.
// Keamanan SQL sudah dijamin prepared statement PDO. Escape HTML dilakukan saat
// DITAMPILKAN (escapeHtml di tools.js), bukan saat disimpan -- kalau di-escape di sini,
// "PT A&B" akan tersimpan permanen sebagai "PT A&amp;B".
function sanitize($val): string {
    return trim((string) $val);
}

// Kirim respons JSON lalu hentikan script.
function jsonResponse(array $data, int $status = 200): void {
    http_response_code($status);
    echo json_encode($data);
    exit;
}

// Baca body request berformat JSON (dikirim fetch dengan JSON.stringify).
// Selalu mengembalikan array, supaya pemanggil tidak perlu cek null.
function readJsonBody(): array {
    $data = json_decode(file_get_contents('php://input'), true);
    return is_array($data) ? $data : [];
}

// Nomor pallet berikutnya untuk item_code + exp_date.
// Cukup melihat tabel stock, karena pallet yang habis tidak dihapus (qty 0),
// jadi nomor lama tidak akan pernah terpakai ulang.
// $conn wajib koneksi yang sama dengan transaksi yang sedang berjalan.
function generatePalletNumber(PDO $conn, string $itemCode, string $expDate): int {
    $query = 'SELECT MAX(pallet_number) FROM stock WHERE item_code = :item_code AND exp_date = :exp_date';

    $stmt = $conn->prepare($query);
    $stmt->execute([
        ':item_code' => $itemCode,
        ':exp_date'  => $expDate,
    ]);

    // MAX() = NULL kalau belum ada sama sekali -> (int) NULL = 0 -> jadi 1.
    return (int) $stmt->fetchColumn() + 1;
}

// Kode dokumen: RMPM + tipe + YYMM + 4 digit urut, mis. RMPMIB26090001.
// COUNT(DISTINCT ...) karena satu dokumen bisa punya banyak baris di ledger.
function generateTxnId(PDO $conn, string $transactionType): string {
    $typeMap = [
        'INBOUND'  => 'IB',
        'OUTBOUND' => 'OB',
        'MUTASI'   => 'MT',
        'RETUR'    => 'RT',
    ];

    if (!isset($typeMap[$transactionType])) {
        throw new Exception("Tipe transaksi tidak dikenal: $transactionType");
    }

    $prefix = 'RMPM' . $typeMap[$transactionType] . date('ym');

    $stmt = $conn->prepare('SELECT COUNT(DISTINCT transaction_code) FROM transactions WHERE transaction_code LIKE :prefix');
    $stmt->execute([':prefix' => $prefix . '%']);
    $count = (int) $stmt->fetchColumn();

    return $prefix . str_pad((string) ($count + 1), 4, '0', STR_PAD_LEFT);
}

// "a, b,,c " -> ['a', 'b', 'c']  (untuk filter yang bisa diisi banyak nilai dipisah koma)
function splitList(string $value): array {
    return array_values(array_filter(
        array_map('trim', explode(',', $value)),
        fn($v) => $v !== ''
    ));
}

// true kalau format 'YYYY-MM-DD' dan tanggalnya benar-benar ada (2026-02-30 = false).
function isValidDate(string $date): bool {
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m)) {
        return false;
    }
    return checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
}

// Escape teks sebelum ditulis ke HTML (pasangan escapeHtml() di tools.js).
// Dipakai di file view PHP, mis. e($row['remark']) di dalam tag <?= ... (tag pendek echo).
function e($value): string {
    return htmlspecialchars((string) ($value ?? ''), ENT_QUOTES, 'UTF-8');
}

// Angka dari database ("1500.250") -> "1.500,25" (format Indonesia, maks 3 desimal).
// Pasangan formatNumber() di tools.js, supaya angka di layar dan di cetakan sama.
function formatNumber($value): string {
    $text = number_format((float) $value, 3, ',', '.'); // "1.500,250"
    return rtrim(rtrim($text, '0'), ',');               // buang nol & koma di belakang
}

// =========================================================
// Sesi login (PHP session)
//
// Server mencatat "siapa yang login" di file sesi. Browser hanya memegang cookie berisi
// ID sesi acak, yang otomatis ikut di setiap fetch ke server yang sama.
// =========================================================

// Sesi berakhir kalau tidak ada request sama sekali selama ini (detik). 8 jam = 1 shift.
const SESSION_IDLE_SECONDS = 8 * 60 * 60;

// Mulai (atau lanjutkan) sesi PHP dengan pengaturan aplikasi ini.
// Aman dipanggil berkali-kali dalam satu request.
function startSession(): void {
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    // File sesi disimpan di folder sendiri, mis. C:\xampp\tmp\wms-rmpm.
    // Kenapa tidak langsung di C:\xampp\tmp: folder itu dipakai bersama aplikasi lain
    // (phpMyAdmin). PHP sesekali menghapus file sesi yang lebih tua dari gc_maxlifetime
    // milik script yang SEDANG jalan (default 24 menit), jadi sesi 8 jam kita bisa ikut
    // terhapus oleh aplikasi lain. Di folder sendiri, hanya aplikasi ini yang membersihkan.
    $paths = explode(';', (string) ini_get('session.save_path')); // formatnya bisa "N;path"
    $dir = rtrim(end($paths) ?: sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'wms-rmpm';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true); // @: dua request bersamaan bisa sama-sama mencoba membuatnya
    }
    session_save_path($dir);

    ini_set('session.gc_maxlifetime', (string) SESSION_IDLE_SECONDS);
    ini_set('session.use_strict_mode', '1'); // tolak ID sesi karangan yang tidak pernah dibuat server

    // Nama cookie sendiri, supaya tidak bentrok dengan aplikasi lain di localhost (PHPSESSID).
    session_name('WMSRMPMSESSID');
    session_set_cookie_params([
        'lifetime' => 0,      // cookie hilang saat browser ditutup
        'path'     => '/',
        'httponly' => true,   // JavaScript tidak bisa membaca cookie -> tidak bisa dicuri lewat XSS
        'samesite' => 'Lax',  // cookie tidak ikut di POST dari situs lain -> cegah CSRF
    ]);

    session_start();
}

// Id user yang sedang login, atau null kalau belum login / sesi sudah menganggur lebih
// dari SESSION_IDLE_SECONDS. Setiap panggilan yang berhasil memperpanjang sesi.
function currentUserId(): ?int {
    startSession();

    $userId       = (int) ($_SESSION['user_id'] ?? 0);
    $lastActivity = (int) ($_SESSION['last_activity'] ?? 0);

    if ($userId === 0 || time() - $lastActivity > SESSION_IDLE_SECONDS) {
        endSession();
        return null;
    }

    $_SESSION['last_activity'] = time();

    // Lepas kunci file sesi. Selama sesi terbuka PHP mengunci file-nya, sehingga request
    // lain dari browser yang sama (mis. autocomplete saat export Excel berjalan) harus
    // antre. Controller cukup tahu user_id, jadi sesi langsung ditutup di sini.
    session_write_close();

    return $userId;
}

// Dipanggil di baris atas setiap controller JSON. Belum login -> balas 401 lalu berhenti.
// Sudah login -> kembalikan id user (dicatat di ledger sebagai pelaku transaksi).
function requireLogin(): int {
    $userId = currentUserId();

    if ($userId === null) {
        jsonResponse(['success' => false, 'error' => 'Sesi login habis, silakan login ulang'], 401);
    }

    return $userId;
}

// Catat user yang baru berhasil login ke sesi.
function beginUserSession(int $userId): void {
    startSession();

    // ID sesi baru setiap kali login (session fixation): kalau penyerang sempat "menanam"
    // ID sesi di browser korban sebelum login, ID itu tidak ikut menjadi sesi yang login.
    session_regenerate_id(true);

    $_SESSION['user_id']       = $userId;
    $_SESSION['last_activity'] = time();
    session_write_close();
}

// Hapus sesi di server dan cookie-nya di browser (logout / sesi kedaluwarsa).
function endSession(): void {
    startSession();
    $_SESSION = [];
    session_destroy();

    $params = session_get_cookie_params();
    setcookie(session_name(), '', [
        'expires'  => 1, // tanggal di masa lalu = browser menghapus cookie
        'path'     => $params['path'],
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}
