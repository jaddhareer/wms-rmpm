<?php

// =========================================================================================
// SCRIPT SEKALI PAKAI: Bin to Bin semua pallet di FLOOR 50, Rak F, Rak E, dan FLOOR 40 ke STAGE.
// HAPUS file ini setelah selesai dipakai.
// =========================================================================================
//
// Apa yang dilakukan: setiap pallet yang masih berisi (qty > 0) di bin-bin itu dipindah UTUH
// ke bin STAGE, sama persis dengan Bin to Bin "Pindah utuh" (cara 1 di controller/BinToBin.php):
//   - stock : hanya kolom bin yang berubah. Nomor pallet, qty, exp, supplier, faktor, remark tetap.
//   - ledger: satu baris MUTASI per pallet, source_bin = bin lama, destination_bin = STAGE,
//             destination_pallet NULL (pallet utuh pindah bin), remark = LEDGER_REMARK.
//             Semua baris memakai SATU kode transaksi (satu dokumen), seperti satu kali Submit.
// Pallet yang sudah habis (qty 0) dibiarkan di bin lamanya: tidak ada barang fisiknya.
// Material di EXCLUDED_ITEMS tidak ikut dipindah (tempatnya memang di FLOOR 40).
// Semua atau tidak sama sekali: satu DB transaction. Satu pallet gagal -> semuanya dibatalkan.
//
// Cara menjalankan (pilih salah satu):
//   CLI     : php scripts/pindah_ke_stage.php                  -> SIMULASI (tidak ada yang tersimpan)
//             php scripts/pindah_ke_stage.php --execute        -> jalankan sungguhan
//             tambah --user=<username> untuk pelaku di ledger (default: admin)
//   Browser : login dulu sebagai admin di aplikasi, lalu buka
//             http://<host>/wms-rmpm/scripts/pindah_ke_stage.php
//             -> SIMULASI + tombol "Jalankan sungguhan" di bawahnya. Pelaku = admin yang login.
//
// Simulasi = semua langkah benar-benar dijalankan di dalam DB transaction lalu di-rollback,
// jadi daftar pallet, kode transaksi, dan error (kalau ada) sama dengan saat dijalankan sungguhan.
// Efek sampingnya hanya nomor id (AUTO_INCREMENT) ledger yang terlewati; tidak ada baris tersimpan.
//
// SQL SELECT ditulis langsung di sini (bukan di model) karena file ini dihapus setelah dipakai.
// Langkah tulisnya memakai model yang sama dengan Bin to Bin: Stock::updateBin() & Transactions::save().

require_once dirname(__DIR__) . '/config/bootstrap.php';

const TARGET_BIN    = 'STAGE';
const LEDGER_REMARK = 'Pindah massal ke STAGE';

// Material yang TIDAK ikut dipindah, dari bin asal mana pun: tempatnya memang di FLOOR 40.
// Pallet item ini tetap di bin-nya sekarang.
const EXCLUDED_ITEMS = ['300012196', '300012204'];

// Kelompok bin asal, urutan = urutan proses & laporan.
const SOURCE_GROUPS = ['FLOOR 50', 'Rak F', 'Rak E', 'FLOOR 40'];

const IS_CLI = PHP_SAPI === 'cli';

// Nama kelompok sebuah bin (salah satu SOURCE_GROUPS), atau null kalau bukan bin asal.
function sourceGroup(string $bin): ?string {
    $bin = strtoupper(trim($bin));
    if ($bin === 'FLOOR 50' || $bin === 'FLOOR 40') {
        return $bin;
    }
    if (str_starts_with($bin, 'F-')) {
        return 'Rak F';
    }
    if (str_starts_with($bin, 'E-')) {
        return 'Rak E';
    }
    return null;
}

// Satu baris laporan. Di browser di-escape (laporan tampil di dalam <pre>).
function out(string $line = ''): void {
    echo IS_CLI ? $line . PHP_EOL : e($line) . "\n";
}

// Tutup laporan lalu berhenti. Di browser, $formHtml (tombol Jalankan) tampil di bawah laporan.
function finish(int $exitCode, string $formHtml = ''): void {
    if (!IS_CLI) {
        echo "</pre>\n" . $formHtml . "</body></html>\n";
    }
    exit($exitCode);
}

function fail(string $message): void {
    out();
    out('GAGAL: ' . $message);
    out('Tidak ada yang diubah.');
    finish(1);
}

// Kolom rata kiri / rata kanan untuk tabel teks.
function col($value, int $width): string  { return str_pad((string) $value, $width); }
function rcol($value, int $width): string { return str_pad((string) $value, $width, ' ', STR_PAD_LEFT); }

// -----------------------------------------------------------------------------------------
// 1. Mode (simulasi / sungguhan) dan user pelaku
// -----------------------------------------------------------------------------------------

set_time_limit(300);

$db = new Database();
$conn = $db->getConnection();

// Jumlah pallet yang terlihat di simulasi (hanya dari tombol di browser). Kalau saat dijalankan
// jumlahnya sudah lain (ada yang Inbound / Bin to Bin di antaranya), batalkan: yang dijalankan
// harus sama dengan yang sudah dilihat.
$expectedCount = null;

if (IS_CLI) {
    $options  = getopt('', ['execute', 'user:']);
    $execute  = isset($options['execute']);
    $username = trim((string) ($options['user'] ?? 'admin'));

    $user = (new UsersModel($conn))->findByUsername($username);
    if (!$user || !(int) $user['is_active']) {
        fwrite(STDERR, "User '$username' tidak ada atau nonaktif. Pakai --user=<username user aktif>." . PHP_EOL);
        exit(1);
    }
    if (!canAccess($user['role'], 'bintobin')) {
        fwrite(STDERR, "User '$username' (role {$user['role']}) tidak punya akses Bin to Bin." . PHP_EOL);
        exit(1);
    }
} else {
    // Browser: hanya admin (role yang punya menu User). Teks biasa, seperti TransactionPrint.php.
    $user = currentUser();
    if ($user === null) {
        http_response_code(401);
        header('Content-Type: text/plain; charset=utf-8');
        exit('Sesi login habis. Login dulu sebagai admin di aplikasi WMS RMPM, lalu buka ulang halaman ini.');
    }
    if (!canAccess($user['role'], 'user')) {
        http_response_code(403);
        header('Content-Type: text/plain; charset=utf-8');
        exit('Hanya admin yang boleh menjalankan script ini.');
    }

    $execute = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && ($_POST['execute'] ?? '') === '1';
    if ($execute) {
        $expectedCount = (int) ($_POST['expected'] ?? -1);
    }

    header('Content-Type: text/html; charset=utf-8');
    echo "<!doctype html><html lang=\"id\"><head><meta charset=\"utf-8\">"
       . "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
       . "<title>Pindah ke STAGE</title></head><body><pre>\n";
}

$userId = (int) $user['id'];

out('PINDAH MASSAL KE ' . TARGET_BIN . ' (Bin to Bin, pallet utuh)');
out('Bin asal : ' . implode(', ', SOURCE_GROUPS));
out('Kecuali  : material ' . implode(', ', EXCLUDED_ITEMS));
out('Mode     : ' . ($execute ? 'SUNGGUHAN (disimpan)' : 'SIMULASI (tidak ada yang disimpan)'));
out('Pelaku   : ' . $user['username'] . ' (id ' . $userId . ')');
out('Waktu    : ' . date('Y-m-d H:i:s'));

// -----------------------------------------------------------------------------------------
// 2. Pindahkan, di dalam satu DB transaction
// -----------------------------------------------------------------------------------------

$sourceWhere = "(s.bin IN ('FLOOR 50', 'FLOOR 40') OR s.bin LIKE 'E-%' OR s.bin LIKE 'F-%')";
$excludedIn  = implode(', ', array_fill(0, count(EXCLUDED_ITEMS), '?')); // "?, ?" -> diisi EXCLUDED_ITEMS

try {
    $conn->beginTransaction();

    // Kunci semua pallet yang akan dipindah (FOR UPDATE), supaya isinya tidak berubah di tengah
    // jalan. Operator yang sedang Outbound / Bin to Bin pallet yang sama menunggu sampai selesai.
    $stmt = $conn->prepare(
        "SELECT s.item_code, s.exp_date, s.pallet_number, s.bin, s.qty_actual, s.qty_sap, m.uom_fisik
         FROM stock s
         JOIN material_master m ON m.item_code = s.item_code
         WHERE s.qty_actual > 0 AND $sourceWhere AND s.item_code NOT IN ($excludedIn)
         FOR UPDATE"
    );
    $stmt->execute(EXCLUDED_ITEMS);
    $pallets = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Pallet habis (qty 0) di bin asal: hanya untuk laporan, tidak dipindah.
    $emptyCount = (int) $conn->query("SELECT COUNT(*) FROM stock s WHERE s.qty_actual <= 0 AND $sourceWhere")
                             ->fetchColumn();

    // Pallet berisi milik material yang dikecualikan di bin asal: hanya untuk laporan, tidak dipindah.
    $stmt = $conn->prepare(
        "SELECT s.item_code, s.bin, COUNT(*) AS pallets
         FROM stock s
         WHERE s.qty_actual > 0 AND $sourceWhere AND s.item_code IN ($excludedIn)
         GROUP BY s.item_code, s.bin
         ORDER BY s.item_code, s.bin"
    );
    $stmt->execute(EXCLUDED_ITEMS);
    $excluded = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Urut per kelompok (urutan SOURCE_GROUPS), lalu bin, item, exp, nomor pallet.
    $groupIndex = array_flip(SOURCE_GROUPS);
    foreach ($pallets as &$pallet) {
        $pallet['group'] = sourceGroup($pallet['bin']);
    }
    unset($pallet);
    usort($pallets, fn($a, $b) =>
        [$groupIndex[$a['group']], $a['bin'], $a['item_code'], $a['exp_date'], (int) $a['pallet_number']]
        <=>
        [$groupIndex[$b['group']], $b['bin'], $b['item_code'], $b['exp_date'], (int) $b['pallet_number']]
    );

    if ($expectedCount !== null && $expectedCount !== count($pallets)) {
        throw new Exception('Data berubah sejak simulasi (' . $expectedCount . ' pallet -> ' . count($pallets)
            . ' pallet). Buka ulang halaman ini untuk simulasi baru.');
    }

    if (!$pallets) {
        $conn->rollBack();
        out();
        out('Tidak ada pallet berisi di bin asal. Tidak ada yang dipindah.');
        finish(0);
    }

    $transactionCode = generateTxnId($conn, 'MUTASI');

    foreach ($pallets as $p) {
        $stock = new Stock($conn);
        $stock->setItemCode($p['item_code']);
        $stock->setExpDate($p['exp_date']);
        $stock->setPalletNumber($p['pallet_number']);
        $stock->setBin(TARGET_BIN);

        // WHERE bin = bin asal: kalau tidak ada baris yang berubah, ada yang tidak beres -> batalkan semua.
        if (!$stock->updateBin($p['bin'])) {
            throw new Exception("Pallet {$p['pallet_number']} ({$p['item_code']}, exp {$p['exp_date']}) tidak ada di bin {$p['bin']}");
        }

        $mutasi = new Transactions($conn);
        $mutasi->setTransactionCode($transactionCode);
        $mutasi->setTransactionType('MUTASI');
        $mutasi->setItemCode($p['item_code']);
        $mutasi->setExpDate($p['exp_date']);
        $mutasi->setPalletNumber($p['pallet_number']);
        $mutasi->setQtyActual($p['qty_actual']);
        $mutasi->setQtySap($p['qty_sap']);
        $mutasi->setSource('Warehouse RMPM');
        $mutasi->setSourceBin($p['bin']);
        $mutasi->setDestination('Warehouse RMPM');
        $mutasi->setDestinationBin(TARGET_BIN);
        $mutasi->setDestinationPallet(null);
        $mutasi->setUserId($userId);
        $mutasi->setRemark(LEDGER_REMARK);
        $mutasi->save();
    }

    if ($execute) {
        $conn->commit();
    } else {
        $conn->rollBack();
    }

} catch (Throwable $e) {
    // Rollback DULU, baru tulis pesan.
    if ($conn->inTransaction()) {
        $conn->rollBack();
    }
    fail($e->getMessage());
}

// -----------------------------------------------------------------------------------------
// 3. Laporan
// -----------------------------------------------------------------------------------------

// Ringkasan per kelompok bin asal.
$summary = array_fill_keys(SOURCE_GROUPS, ['pallets' => 0, 'bins' => [], 'qty_sap' => 0.0]);
foreach ($pallets as $p) {
    $summary[$p['group']]['pallets']++;
    $summary[$p['group']]['bins'][$p['bin']] = true;
    $summary[$p['group']]['qty_sap'] += (float) $p['qty_sap'];
}

out();
out('RINGKASAN');
out(col('Bin asal', 10) . rcol('Pallet', 8) . rcol('Bin', 6) . rcol('Total qty SAP', 22));
foreach ($summary as $group => $row) {
    out(col($group, 10) . rcol($row['pallets'], 8) . rcol(count($row['bins']), 6) . rcol(formatQtySap($row['qty_sap']), 22));
}
out(col('TOTAL', 10) . rcol(count($pallets), 8)
    . rcol(array_sum(array_map(fn($row) => count($row['bins']), $summary)), 6)
    . rcol(formatQtySap(array_sum(array_column($summary, 'qty_sap'))), 22));
if ($emptyCount > 0) {
    out("($emptyCount pallet habis / qty 0 di bin asal tidak dipindah)");
}
foreach ($excluded as $row) {
    out("(Dikecualikan, tetap di tempat: {$row['item_code']} di {$row['bin']}, {$row['pallets']} pallet)");
}

out();
out('DETAIL');
out(rcol('No', 4) . '  ' . col('Bin asal', 11) . col('Item code', 11) . col('Exp', 12)
    . rcol('Pallet', 6) . rcol('Qty', 14) . '  ' . col('UoM', 6) . rcol('Qty SAP', 18));
foreach ($pallets as $i => $p) {
    out(rcol($i + 1, 4) . '  ' . col($p['bin'], 11) . col($p['item_code'], 11) . col($p['exp_date'], 12)
        . rcol($p['pallet_number'], 6) . rcol(formatNumber($p['qty_actual']), 14) . '  ' . col($p['uom_fisik'], 6)
        . rcol(formatQtySap($p['qty_sap']), 18));
}

out();
if ($execute) {
    out('SELESAI. ' . count($pallets) . ' pallet dipindah ke ' . TARGET_BIN . '. Kode transaksi: ' . $transactionCode);
    out('Hapus file scripts/pindah_ke_stage.php sekarang.');
    finish(0);
}

out('SIMULASI SELESAI, tidak ada yang disimpan.');
out('Kalau dijalankan sekarang: ' . count($pallets) . ' pallet pindah ke ' . TARGET_BIN . ', kode transaksi ' . $transactionCode . '.');

if (IS_CLI) {
    out('Jalankan sungguhan: php scripts/pindah_ke_stage.php --execute' . ($username !== 'admin' ? ' --user=' . $username : ''));
    finish(0);
}

// Browser: tombol POST. Cookie sesi SameSite=Lax tidak ikut di POST dari situs lain, jadi
// tombol ini tidak bisa "dipencet" dari halaman luar (CSRF).
finish(0,
    '<form method="post">'
    . '<input type="hidden" name="execute" value="1">'
    . '<input type="hidden" name="expected" value="' . count($pallets) . '">'
    . '<button type="submit">Jalankan sungguhan: pindahkan ' . count($pallets) . ' pallet ke ' . e(TARGET_BIN) . '</button>'
    . '</form>'
);
