<?php

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

$itemCode = sanitize($_GET['item_code'] ?? '');

if ($itemCode === '') {
    jsonResponse(['error' => 'Item Code wajib diisi'], 400);
}

$db = new Database();
$conn = $db->getConnection();

$stock = new Stock($conn);

// Array pallet, urut FEFO. Array kosong = tidak ada stok (bukan error).
jsonResponse($stock->getStockByItemCode($itemCode));