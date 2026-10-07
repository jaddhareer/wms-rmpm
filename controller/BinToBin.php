<?php

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

if ($itemCode === '' || $expDate === '' || $palletNumber === 0 || $sourceBin === '' || $targetBin === '') {
    jsonResponse(['success' => false, 'error' => 'Semua field wajib diisi'], 400);
}

if ($sourceBin === $targetBin) {
    jsonResponse(['success' => false, 'error' => 'Source bin dan target bin tidak boleh sama'], 400);
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

    $stock = $binToBin->findPallet();

    if (!$stock) {
        throw new Exception("Pallet $palletNumber ($itemCode, exp $expDate) tidak ditemukan");
    }
    if ((float) $stock['qty_actual'] <= 0) {
        throw new Exception("Pallet $palletNumber ($itemCode, exp $expDate) sudah kosong");
    }

    // Kalau pallet tidak ada di bin asal, tidak ada baris yang berubah -> batalkan semuanya.
    if (!$binToBin->updateBin($sourceBin)) {
        throw new Exception("Pallet $palletNumber tidak ada di bin $sourceBin (posisi sekarang: {$stock['bin']})");
    }

    $mutasi = new Transactions($conn);
    $mutasi->setTransactionCode($transactionCode);
    $mutasi->setTransactionType('MUTASI');
    $mutasi->setItemCode($itemCode);
    $mutasi->setExpDate($expDate);
    $mutasi->setPalletNumber($palletNumber);
    $mutasi->setQtyActual($stock['qty_actual']);
    $mutasi->setQtySap($stock['qty_sap']);
    $mutasi->setSource('Warehouse RMPM');
    $mutasi->setSourceBin($sourceBin);
    $mutasi->setDestination('Warehouse RMPM');
    $mutasi->setDestinationBin($targetBin);
    $mutasi->setUserId($userId);
    $mutasi->setRemark('');
    $mutasi->save();

    $conn->commit();

    jsonResponse([
        'success' => true,
        'message' => "Pallet $palletNumber ($itemCode, exp $expDate) dipindahkan dari $sourceBin ke $targetBin. Kode transaksi: $transactionCode",
    ]);

} catch (Exception $e) {
    // Rollback DULU. jsonResponse() diakhiri exit, jadi apa pun setelahnya tidak dijalankan.
    if ($conn->inTransaction()) {
        $conn->rollBack();
    }
    jsonResponse(['success' => false, 'error' => $e->getMessage()], 400);
}