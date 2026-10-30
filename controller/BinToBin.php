<?php

// Bin to Bin, dua cara:
//   1. Pallet utuh pindah bin (target_pallet kosong): baris stock hanya berganti bin.
//   2. Gabung ke pallet lain (target_pallet diisi): sebagian/semua isi pallet asal ditumpuk ke
//      pallet item + exp yang sama yang sudah ada di target bin. Dipakai saat gudang kehabisan
//      pallet: isi satu pallet disebar ke pallet-pallet lain, pallet fisiknya bisa dipakai lagi.
//      Pallet asal yang habis tetap ada dengan qty 0 (tidak dihapus).
// Pindah SEBAGIAN tanpa pallet tujuan ditolak: identitas pallet tidak memuat bin, jadi satu
// pallet tidak bisa tercatat di dua bin.
//
// Body POST (JSON): { source_bin, target_bin, item_code, exp_date, pallet_number,
//                     qty_actual (kosong = semua isi pallet), target_pallet (kosong = pindah utuh) }

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

// Belum login -> 401, role tanpa menu 'bintobin' -> 403. $userId dicatat di ledger sebagai pelaku transaksi.
$userId = requireLogin('bintobin');

$data = readJsonBody();

$sourceBin    = strtoupper(sanitize($data['source_bin'] ?? ''));
$targetBin    = strtoupper(sanitize($data['target_bin'] ?? ''));
$itemCode     = sanitize($data['item_code'] ?? '');
$expDate      = sanitize($data['exp_date'] ?? '');
$palletNumber = (int) ($data['pallet_number'] ?? 0);
$qtyInput     = ($data['qty_actual'] ?? '') === '' ? null : round((float) $data['qty_actual'], 3);
$targetPallet = (int) ($data['target_pallet'] ?? 0);

if ($itemCode === '' || $expDate === '' || $palletNumber === 0 || $sourceBin === '' || $targetBin === '') {
    jsonResponse(['success' => false, 'error' => 'Semua field wajib diisi'], 400);
}

if ($sourceBin === $targetBin) {
    jsonResponse(['success' => false, 'error' => 'Source bin dan target bin tidak boleh sama'], 400);
}

if ($qtyInput !== null && $qtyInput <= 0) {
    jsonResponse(['success' => false, 'error' => 'Quantity harus lebih dari 0'], 400);
}

if ($targetPallet === $palletNumber) {
    jsonResponse(['success' => false, 'error' => 'Pallet tujuan tidak boleh sama dengan pallet asal'], 400);
}

$db = new Database();
$conn = $db->getConnection();

try {
    $conn->beginTransaction();

    $transactionCode = generateTxnId($conn, 'MUTASI');

    $binToBin = new Stock($conn);
    $binToBin->setItemCode($itemCode);
    $binToBin->setExpDate($expDate);
    $binToBin->setPalletNumber($palletNumber);
    $binToBin->setBin($targetBin);

    $target = null;
    if ($targetPallet > 0) {
        $target = new Stock($conn);
        $target->setItemCode($itemCode);
        $target->setExpDate($expDate);
        $target->setPalletNumber($targetPallet);
    }

    // Dua pallet dikunci selalu dengan urutan nomor kecil dulu. Kalau dua operator
    // bersamaan menggabung 5 -> 1 dan 1 -> 5, yang kedua cukup menunggu, tidak saling
    // mengunci selamanya (deadlock).
    if ($target && $targetPallet < $palletNumber) {
        $targetStock = $target->findPallet();
        $stock = $binToBin->findPallet();
    } else {
        $stock = $binToBin->findPallet();
        $targetStock = $target ? $target->findPallet() : null;
    }

    if (!$stock) {
        throw new Exception("Pallet $palletNumber ($itemCode, exp $expDate) tidak ditemukan");
    }
    if ((float) $stock['qty_actual'] <= 0) {
        throw new Exception("Pallet $palletNumber ($itemCode, exp $expDate) sudah kosong");
    }

    // Qty kosong = semua isi pallet. Selisih di bawah 0,0005 dianggap semua (pembulatan 3 desimal).
    $qtyAvailable = (float) $stock['qty_actual'];
    $qty = $qtyInput ?? $qtyAvailable;
    if ($qty > $qtyAvailable + 0.0005) {
        throw new Exception("Quantity melebihi isi pallet $palletNumber (sisa " . formatNumber($qtyAvailable) . ")");
    }
    $takesAll = abs($qty - $qtyAvailable) < 0.0005;

    if (!$target) {
        // 1. Pallet utuh pindah bin.
        if (!$takesAll) {
            throw new Exception("Pindah sebagian harus digabung ke pallet $itemCode exp $expDate yang ada di bin $targetBin. Pilih pallet tujuan, atau pindahkan pallet utuh");
        }

        // Kalau pallet tidak ada di bin asal, tidak ada baris yang berubah -> batalkan semuanya.
        if (!$binToBin->updateBin($sourceBin)) {
            throw new Exception("Pallet $palletNumber tidak ada di bin $sourceBin (posisi sekarang: {$stock['bin']})");
        }

        $qty = $stock['qty_actual'];
        $qtySap = $stock['qty_sap'];
        $message = "Pallet $palletNumber ($itemCode, exp $expDate) dipindahkan dari $sourceBin ke $targetBin";

    } else {
        // 2. Gabung ke pallet tujuan.
        if (strtoupper($stock['bin']) !== $sourceBin) {
            throw new Exception("Pallet $palletNumber tidak ada di bin $sourceBin (posisi sekarang: {$stock['bin']})");
        }
        if (!$targetStock || (float) $targetStock['qty_actual'] <= 0) {
            throw new Exception("Pallet tujuan $targetPallet ($itemCode, exp $expDate) tidak ada di gudang (tidak ditemukan atau sudah kosong)");
        }
        if (strtoupper($targetStock['bin']) !== $targetBin) {
            throw new Exception("Pallet tujuan $targetPallet tidak ada di bin $targetBin (posisi sekarang: {$targetStock['bin']})");
        }

        // Supplier dan faktor konversi harus sama: supplier per pallet tetap bisa dilacak,
        // dan qty SAP pallet tujuan tetap = qty x faktornya.
        $supplier = trim((string) $stock['supplier']);
        $targetSupplier = trim((string) $targetStock['supplier']);
        if (strcasecmp($supplier, $targetSupplier) !== 0) {
            throw new Exception("Pallet $palletNumber dan pallet $targetPallet beda supplier (" . ($supplier ?: '-') . ' / ' . ($targetSupplier ?: '-') . '), tidak bisa digabung');
        }
        $factor = (float) $stock['conversion_factor'];
        if (abs($factor - (float) $targetStock['conversion_factor']) > 0.00005) {
            throw new Exception("Pallet $palletNumber dan pallet $targetPallet beda faktor konversi ({$stock['conversion_factor']} / {$targetStock['conversion_factor']}), tidak bisa digabung");
        }

        // Ambil semua sisa -> qty SAP = sisa qty SAP persis, sama seperti Outbound pallet habis.
        if ($takesAll) {
            $qty = $qtyAvailable;
            $qtySap = (float) $stock['qty_sap'];
        } else {
            $qtySap = calculateQtySap($qty, $factor);
        }

        $binToBin->setQtyActual($qty);
        $binToBin->setQtySap($qtySap);
        if (!$binToBin->stockout()) {
            throw new Exception("Stok pallet $palletNumber tidak cukup (sisa {$stock['qty_actual']})");
        }

        $target->setQtyActual($qty);
        $target->setQtySap($qtySap);
        if (!$target->addQty($targetBin)) {
            throw new Exception("Gagal menambah qty ke pallet $targetPallet");
        }

        $message = 'Qty ' . formatNumber($qty) . " dari pallet $palletNumber ($itemCode, exp $expDate) digabung ke pallet $targetPallet di $targetBin"
            . ($takesAll ? ". Pallet $palletNumber sekarang kosong" : '. Sisa pallet ' . $palletNumber . ': ' . formatNumber($qtyAvailable - $qty));
    }

    $mutasi = new Transactions($conn);
    $mutasi->setTransactionCode($transactionCode);
    $mutasi->setTransactionType('MUTASI');
    $mutasi->setItemCode($itemCode);
    $mutasi->setExpDate($expDate);
    $mutasi->setPalletNumber($palletNumber);
    $mutasi->setQtyActual($qty);
    $mutasi->setQtySap($qtySap);
    $mutasi->setSource('Warehouse RMPM');
    $mutasi->setSourceBin($sourceBin);
    $mutasi->setDestination('Warehouse RMPM');
    $mutasi->setDestinationBin($targetBin);
    $mutasi->setDestinationPallet($target ? $targetPallet : null);
    $mutasi->setUserId($userId);
    $mutasi->setRemark('');
    $mutasi->save();

    $conn->commit();

    jsonResponse([
        'success' => true,
        'transaction_code' => $transactionCode,
        'message' => "$message. Kode transaksi: $transactionCode",
    ]);

} catch (Exception $e) {
    // Rollback DULU. jsonResponse() diakhiri exit, jadi apa pun setelahnya tidak dijalankan.
    if ($conn->inTransaction()) {
        $conn->rollBack();
    }
    jsonResponse(['success' => false, 'error' => $e->getMessage()], 400);
}
