<?php

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

$db = new Database();
$conn = $db->getConnection();

try {
    $conn->beginTransaction();

    $transactionCode = generateTxnId($conn, 'MUTASI');

    $itemCode = sanitize($_POST['item_code'] ?? '');
    $expDate = sanitize($_POST['exp_date'] ?? '');
    $palletNumber = sanitize($_POST['pallet_number'] ?? '');
    $sourceBin = sanitize($_POST['source_bin'] ?? '');
    $targetBin = sanitize($_POST['target_bin'] ?? '');

    if ($itemCode === '' || $expDate === '' || $palletNumber === '' || $sourceBin === '' || $targetBin === '') {
        jsonResponse(['error' => 'Semua field wajib diisi'], 400);
    }

    $binToBin = new Stock($conn);
    $binToBin->setItemCode($itemCode);
    $binToBin->setExpDate($expDate);
    $binToBin->setPalletNumber($palletNumber);
    $binToBin->setBin($targetBin);
    $binToBin->updateBin();

    $mutasi = new Transactions($conn);
    $mutasi->setTransactionCode($transactionCode);
    $mutasi->setTransactionType('MUTASI');
    $mutasi->setItemCode($itemCode);
    $mutasi->setExpDate($expDate);
    $mutasi->setPalletNumber($palletNumber);
    $mutasi->setSource('Warehouse RMPM');
    $mutasi->setSourceBin($sourceBin);
    $mutasi->setDestination('Warehouse RMPM');
    $mutasi->setDestinationBin($targetBin);
    $mutasi->save();

    $conn->commit();
    jsonResponse(['success' => true, 'message' => "Pallet $palletNumber ($itemCode, exp $expDate) berhasil dipindahkan dari bin $sourceBin ke bin $targetBin dengan kode transaksi $transactionCode"]);

} catch (Exception $e) {
    jsonResponse(['error' => 'Terjadi kesalahan saat mengambil data bin to bin', 'details' => $e->getMessage()], 500);
}

?>