<?php

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

$db = new Database();
$conn = $db->getConnection();

// $itemCode = isset($_GET['item_code']) ? sanitize($_GET['item_code']) : null;
$itemCode = sanitize($_GET['item_code'] ?? ''); // Menggunakan null coalescing operator untuk default value

if (!$itemCode) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Item Code wajib diisi']);
    exit;
}

$stock = new Stock($conn);
$requestedStock = $stock->getStockByItemCode($itemCode);
$response = [];

foreach ($requestedStock as $stock) {
    $response[] = [
        'item_code' => $stock['item_code'],
        'description' => $stock['description'],
        'exp_date' => $stock['exp_date'],
        'pallet_number' => $stock['pallet_number'],
        'bin' => $stock['bin'],
        'qty_actual' => $stock['qty_actual'],
        'conversion_factor' => $stock['conversion_factor'],
        'qty_sap' => $stock['qty_sap'],
        'remark' => $stock['remark']
    ];
}

echo json_encode($response);