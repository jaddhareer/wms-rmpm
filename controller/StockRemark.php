<?php

// Edit satu pallet dari popup detail Stock Overview: remark manual (semua role yang boleh
// membuka Stock Overview), dan exp date (hanya role dengan aksi 'edit-exp', lihat ROLE_ACTIONS).
// Body POST (JSON): { item_code, exp_date, pallet_number, remark, new_exp_date? }
//   remark kosong       = hapus remark
//   new_exp_date kosong / sama dengan exp_date = exp tidak diubah
//
// REMARK: stock.remark diganti dengan teks baru, lalu perubahannya dicatat di ledger sebagai MUTASI
// di bin yang sama: source_bin = destination_bin = bin pallet sekarang, qty = isi pallet saat
// itu (snapshot), remark = "Remark stok: ...". Qty dan bin tidak berubah, jadi replay ledger
// di Dashboard juga tidak berubah.
//
// EXP DATE (mis. staff salah input exp saat Inbound, daripada Outbound lalu Inbound lagi):
// identitas pallet = item + exp + nomor pallet, jadi exp TIDAK di-UPDATE di baris yang sama.
// Kalau di-UPDATE, MAX(pallet_number) exp lama bisa turun dan nomor itu dipakai ulang oleh
// Inbound berikutnya (riwayat dua pallet fisik tercampur di ledger). Yang dilakukan:
//   - pallet lama dikosongkan (qty 0, tidak dihapus, sama seperti pallet habis)
//   - isinya jadi pallet baru: exp baru, nomor = generatePalletNumber() untuk exp baru, bin,
//     supplier, faktor, qty, qty SAP sama dengan pallet lama
//   - ledger: satu dokumen MUTASI berisi 2 baris (keputusan Hariri, tanpa kolom baru):
//       baris keluar: exp & pallet lama, source_bin = bin, destination_bin NULL
//       baris masuk : exp & pallet baru, source_bin NULL, destination_bin = bin
//     remark keduanya "Edit exp date: dari <lama> ke <baru>" + nomor pallet pasangannya.
//     Replay Dashboard (occupancyTrend) mengenali dua baris ini dari bin yang kosong.
// Kalau remark ikut diganti, pallet baru memakai remark baru dan ada baris ke-3 "Remark stok: ..."
// (format remark biasa) untuk pallet baru, di dokumen yang sama.

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

// Dibuka dari popup detail Stock Overview. $userId dicatat di ledger sebagai pelaku.
$userId = requireLogin('stock');

// Kolom remark di ledger VARCHAR(255), dan diawali "Remark stok: " (13 karakter).
const STOCK_REMARK_MAX = 240;

$data = readJsonBody();

$itemCode     = sanitize($data['item_code'] ?? '');
$expDate      = sanitize($data['exp_date'] ?? '');
$palletNumber = (int) ($data['pallet_number'] ?? 0);
$remark       = sanitize($data['remark'] ?? '');
$newExpDate   = sanitize($data['new_exp_date'] ?? '');

if ($itemCode === '' || $expDate === '' || $palletNumber <= 0) {
    jsonResponse(['success' => false, 'error' => 'Identitas pallet tidak lengkap'], 400);
}

if (mb_strlen($remark) > STOCK_REMARK_MAX) {
    jsonResponse(['success' => false, 'error' => 'Remark maksimal ' . STOCK_REMARK_MAX . ' karakter'], 400);
}

$editExp = $newExpDate !== '' && $newExpDate !== $expDate;

if ($editExp) {
    // requireLogin() di atas hanya mengembalikan id. Role dibaca lagi (satu query), hanya kalau
    // exp memang diubah. Bukan 401: user ini login, hanya tidak punya haknya.
    $user = currentUser();
    if ($user === null || !canDo($user['role'], 'edit-exp')) {
        jsonResponse(['success' => false, 'error' => 'Anda tidak punya akses untuk mengubah exp date'], 403);
    }
    if (!isValidDate($newExpDate)) {
        jsonResponse(['success' => false, 'error' => 'Exp date baru tidak valid'], 400);
    }
}

$db = new Database();
$conn = $db->getConnection();

// Satu baris ledger MUTASI untuk pallet ini. $sourceBin / $destinationBin null = sisi itu kosong
// (dipakai baris keluar / masuk edit exp date).
function saveMutasi(PDO $conn, string $code, int $userId, array $pallet, string $expDate, int $palletNumber,
                    ?string $sourceBin, ?string $destinationBin, string $remark): void {
    $ledger = new Transactions($conn);
    $ledger->setTransactionCode($code);
    $ledger->setTransactionType('MUTASI');
    $ledger->setItemCode($pallet['item_code']);
    $ledger->setExpDate($expDate);
    $ledger->setPalletNumber($palletNumber);
    $ledger->setQtyActual($pallet['qty_actual']);
    $ledger->setQtySap($pallet['qty_sap']);
    $ledger->setSource('Warehouse RMPM');
    $ledger->setSourceBin($sourceBin);
    $ledger->setDestination('Warehouse RMPM');
    $ledger->setDestinationBin($destinationBin);
    $ledger->setUserId($userId);
    $ledger->setRemark($remark);
    $ledger->save();
}

try {
    $conn->beginTransaction();

    $stock = new Stock($conn);
    $stock->setItemCode($itemCode);
    $stock->setExpDate($expDate);
    $stock->setPalletNumber($palletNumber);

    // Dikunci sampai commit: qty & bin yang dicatat di ledger pasti kondisi terbaru.
    $pallet = $stock->findPallet();
    if (!$pallet || (float) $pallet['qty_actual'] <= 0) {
        throw new Exception("Pallet $palletNumber ($itemCode, exp $expDate) tidak ada stoknya");
    }

    $remarkChanged = $remark !== trim((string) $pallet['remark']);
    if (!$editExp && !$remarkChanged) {
        throw new Exception('Remark tidak berubah');
    }

    $transactionCode = generateTxnId($conn, 'MUTASI');
    $bin = $pallet['bin'];
    $stockRemark = $remark !== '' ? "Remark stok: $remark" : 'Remark stok dihapus';

    if (!$editExp) {
        $stock->setRemark($remark);
        $stock->updateRemark();

        saveMutasi($conn, $transactionCode, $userId, $pallet, $expDate, $palletNumber, $bin, $bin, $stockRemark);

        $conn->commit();

        jsonResponse([
            'success' => true,
            'transaction_code' => $transactionCode,
            'exp_date' => $expDate,
            'message' => "Remark pallet $palletNumber ($itemCode, exp $expDate) "
                . ($remark !== '' ? 'disimpan' : 'dihapus') . ". Kode transaksi: $transactionCode",
        ]);
    }

    // ---- Edit exp date ----
    $newPallet = generatePalletNumber($conn, $itemCode, $newExpDate);

    // 1. Pallet lama dikosongkan. Qty SAP ikut persis sisa qty SAP-nya, jadi tidak ada selisih.
    //    Syarat qty_actual >= qty di stockout() tetap jadi pengaman.
    $stock->setQtyActual($pallet['qty_actual']);
    $stock->setQtySap($pallet['qty_sap']);
    if (!$stock->stockout()) {
        throw new Exception("Gagal mengosongkan pallet $palletNumber ($itemCode, exp $expDate)");
    }

    // 2. Isinya jadi pallet baru dengan exp baru, di bin yang sama.
    $moved = new Stock($conn);
    $moved->setItemCode($itemCode);
    $moved->setExpDate($newExpDate);
    $moved->setPalletNumber($newPallet);
    $moved->setSupplier($pallet['supplier']);
    $moved->setBin($bin);
    $moved->setQtyActual($pallet['qty_actual']);
    $moved->setConversionFactor($pallet['conversion_factor']);
    $moved->setQtySap($pallet['qty_sap']);
    $moved->setRemark($remark);   // sama dengan remark lama kalau remark tidak diganti
    $moved->stockin();

    // 3. Ledger: baris keluar (pallet lama) + baris masuk (pallet baru).
    $change = "Edit exp date: dari $expDate ke $newExpDate";
    saveMutasi($conn, $transactionCode, $userId, $pallet, $expDate, $palletNumber, $bin, null, "$change (jadi pallet $newPallet)");
    saveMutasi($conn, $transactionCode, $userId, $pallet, $newExpDate, $newPallet, null, $bin, "$change (dari pallet $palletNumber)");

    if ($remarkChanged) {
        saveMutasi($conn, $transactionCode, $userId, $pallet, $newExpDate, $newPallet, $bin, $bin, $stockRemark);
    }

    $conn->commit();

    jsonResponse([
        'success' => true,
        'transaction_code' => $transactionCode,
        'exp_date' => $newExpDate,
        'pallet_number' => $newPallet,
        'message' => "Exp date pallet $palletNumber ($itemCode) diubah dari $expDate ke $newExpDate,"
            . " sekarang pallet $newPallet di $bin" . ($remarkChanged ? ', remark ikut diganti' : '')
            . ". Kode transaksi: $transactionCode",
    ]);

} catch (Exception $e) {
    // Rollback DULU. jsonResponse() diakhiri exit, jadi apa pun setelahnya tidak dijalankan.
    if ($conn->inTransaction()) {
        $conn->rollBack();
    }
    jsonResponse(['success' => false, 'error' => $e->getMessage()], 400);
}
