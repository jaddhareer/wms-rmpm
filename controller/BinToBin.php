<?php

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

$db = new Database();
$conn = $db->getConnection();

$transactionCode = generateTxnId($conn, 'MUTASI');

$data = readJsonBody();

$sourceBin    = sanitize($data['source_bin'] ?? '');
$targetBin    = sanitize($data['target_bin'] ?? '');
$itemCode     = sanitize($data['item_code'] ?? '');
$expDate      = sanitize($data['exp_date'] ?? '');
$palletNumber = (int) ($data['pallet_number'] ?? 0);

if ($itemCode === '' || $expDate === '' || $palletNumber === 0 || $sourceBin === '' || $targetBin === '') {
    jsonResponse(['error' => 'Semua field wajib diisi'], 400);
}

if ($sourceBin === $targetBin) {
    jsonResponse(['error' => 'Source bin dan target bin tidak boleh sama'], 400);
}

try {
    $conn->beginTransaction();

    $binToBin = new Stock($conn);
    $binToBin->setItemCode($itemCode);
    $binToBin->setExpDate($expDate);
    $binToBin->setPalletNumber($palletNumber);
    $binToBin->setBin($targetBin);

    $stock = $binToBin->findPallet();

    if (!$stock) {
        throw new Exception("Pallet $palletNumber ($itemCode, exp $expDate) tidak ditemukan di bin $sourceBin");
    }

    $binToBin->updateBin();

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
    $mutasi->setUserId(1); // TODO: ganti dengan user_id dari sesi login begitu fitur login sudah ada
    $mutasi->setRemark('Mutasi bin to bin');
    $mutasi->save();

    $conn->commit();
    jsonResponse(['success' => true, 'message' => "Pallet $palletNumber ($itemCode, exp $expDate) berhasil dipindahkan dari bin $sourceBin ke bin $targetBin dengan kode transaksi $transactionCode"]);

} catch (Exception $e) {
    jsonResponse(['success' => false, 'error' => 'Terjadi kesalahan saat mengambil data bin to bin', 'details' => $e->getMessage()], 500);
    $conn->rollback();
}