<?php

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

$db = new Database();
$conn = $db->getConnection();

$items = json_decode(file_get_contents('php://input'), true);

if (!is_array($items) || count($items) === 0) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Tidak ada data pallet yang dikirim']);
    exit;
}

// TODO: ganti dengan user_id dari sesi login begitu User Management sudah ada
$userId = 1;
$transactionCode = generateTxnId($conn, 'INBOUND');

// Asumsi yang saya ambil (koreksi kalau maunya beda): satu kali submit dari state
// dianggap satu kesatuan -- kalau satu pallet gagal, semua di-rollback, operator
// submit ulang semuanya. Makanya beginTransaction() di luar loop, bukan di dalam.
try {
    $conn->beginTransaction();

    foreach ($items as $item) {
        $itemCode  = sanitize($item['item_code']);
        $expDate   = sanitize($item['exp_date']);
        $source    = sanitize($item['source']);
        $qtyActual = sanitize((float) $item['qty_actual']);
        $conversionFactor = sanitize((float) $item['conversion_factor']);
        $qtySap    = sanitize((float) $item['qty_sap']);
        $destination = 'Warehouse RMPM';
        $bin       = sanitize($item['bin']);
        $remark    = sanitize($item['remark'] ?? '');

        // Nomor pallet dihitung ULANG di server (tidak percaya nomor yang sudah nempel
        // dari frontend) -- pakai $conn yang sama supaya pallet yang baru saja di-insert
        // di iterasi sebelumnya, dalam transaction yang sama, ikut kehitung.
        $palletNumber = generatePalletNumber($conn, $itemCode, $expDate);

        $stock = new Stock($conn);
        $stock->setItemCode($itemCode);
        $stock->setExpDate($expDate);
        $stock->setPalletNumber($palletNumber);
        $stock->setBin($bin);
        $stock->setQtyActual($qtyActual);
        $stock->setConversionFactor($conversionFactor);
        $stock->setQtySap($qtySap);
        $stock->setRemark($remark);
        $stock->stockin();

        $transaction = new Transactions($conn);
        $transaction->setTransactionCode($transactionCode);
        $transaction->setTransactionType('INBOUND');
        $transaction->setItemCode($itemCode);
        $transaction->setExpDate($expDate);
        $transaction->setPalletNumber($palletNumber);
        $transaction->setQtyActual($qtyActual);
        $transaction->setQtySap($qtySap);
        $transaction->setSource($source);
        $transaction->setDestination($destination);
        $transaction->setDestinationBin($bin);
        $transaction->setUserId($userId);
        $transaction->setRemark($remark);
        $transaction->save();

    }

    $conn->commit();

    echo json_encode(['success' => true, 'transaction_code' => $transactionCode]);

} catch (Exception $e) {
    $conn->rollBack();
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}