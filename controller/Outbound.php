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

$userId = 1;
$transactionCode = generateTxnId($conn, 'OUTBOUND');

try {
    $conn->beginTransaction();

    foreach ($items as $item) {
        $itemCode  = sanitize($item['item_code']);
        $expDate   = sanitize($item['exp_date']);
        $destination= sanitize($item['destination']);
        $qtyActual = sanitize((float) $item['qty_actual']);
        $conversionFactor = sanitize((float) $item['conversion_factor']);
        $qtySap    = sanitize((float) $item['qty_sap']);
        $source    = sanitize($item['source'] ?? 'Warehouse RMPM');
        $bin       = sanitize($item['bin']);
        $remark    = sanitize($item['remark'] ?? '');
        $palletNumber = sanitize((int) $item['pallet_number']);

        $stock = new Stock($conn);
        $stock->setItemCode($itemCode);
        $stock->setExpDate($expDate);
        $stock->setPalletNumber($palletNumber);
        $stock->setBin($bin);
        $stock->setQtyActual($qtyActual);
        $stock->setConversionFactor($conversionFactor);
        $stock->setQtySap($qtySap);
        $stock->setRemark($remark);
        $stock->stockout();

        $transaction = new Transactions($conn);
        $transaction->setTransactionCode($transactionCode);
        $transaction->setTransactionType('OUTBOUND');
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