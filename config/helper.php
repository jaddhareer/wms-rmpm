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
