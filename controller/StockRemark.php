<?php

// Remark manual pada satu pallet, mis. stok yang tiba-tiba di-reject QC.
// Body POST (JSON): { item_code, exp_date, pallet_number, remark }   (remark kosong = hapus remark)
//
// stock.remark diganti dengan teks baru, lalu perubahannya dicatat di ledger sebagai MUTASI
// di bin yang sama: source_bin = destination_bin = bin pallet sekarang, qty = isi pallet saat
// itu (snapshot), remark = "Remark stok: ...". Qty dan bin tidak berubah, jadi replay ledger
// di Dashboard juga tidak berubah.

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

if ($itemCode === '' || $expDate === '' || $palletNumber <= 0) {
    jsonResponse(['success' => false, 'error' => 'Identitas pallet tidak lengkap'], 400);
}

if (mb_strlen($remark) > STOCK_REMARK_MAX) {
    jsonResponse(['success' => false, 'error' => 'Remark maksimal ' . STOCK_REMARK_MAX . ' karakter'], 400);
}

$db = new Database();
$conn = $db->getConnection();

try {
    $conn->beginTransaction();

    $transactionCode = generateTxnId($conn, 'MUTASI');

    $stock = new Stock($conn);
    $stock->setItemCode($itemCode);
    $stock->setExpDate($expDate);
    $stock->setPalletNumber($palletNumber);

    // Dikunci sampai commit: qty & bin yang dicatat di ledger pasti kondisi terbaru.
    $pallet = $stock->findPallet();
    if (!$pallet || (float) $pallet['qty_actual'] <= 0) {
        throw new Exception("Pallet $palletNumber ($itemCode, exp $expDate) tidak ada stoknya");
    }
    if ($remark === trim((string) $pallet['remark'])) {
        throw new Exception('Remark tidak berubah');
    }

    $stock->setRemark($remark);
    $stock->updateRemark();

    $ledger = new Transactions($conn);
    $ledger->setTransactionCode($transactionCode);
    $ledger->setTransactionType('MUTASI');
    $ledger->setItemCode($itemCode);
    $ledger->setExpDate($expDate);
    $ledger->setPalletNumber($palletNumber);
    $ledger->setQtyActual($pallet['qty_actual']);
    $ledger->setQtySap($pallet['qty_sap']);
    $ledger->setSource('Warehouse RMPM');
    $ledger->setSourceBin($pallet['bin']);
    $ledger->setDestination('Warehouse RMPM');
    $ledger->setDestinationBin($pallet['bin']);   // bin tetap
    $ledger->setUserId($userId);
    $ledger->setRemark($remark !== '' ? "Remark stok: $remark" : 'Remark stok dihapus');
    $ledger->save();

    $conn->commit();

    jsonResponse([
        'success' => true,
        'transaction_code' => $transactionCode,
        'message' => "Remark pallet $palletNumber ($itemCode, exp $expDate) "
            . ($remark !== '' ? 'disimpan' : 'dihapus') . ". Kode transaksi: $transactionCode",
    ]);

} catch (Exception $e) {
    // Rollback DULU. jsonResponse() diakhiri exit, jadi apa pun setelahnya tidak dijalankan.
    if ($conn->inTransaction()) {
        $conn->rollBack();
    }
    jsonResponse(['success' => false, 'error' => $e->getMessage()], 400);
}
