<?php

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

requireLogin(); // cukup login: dipakai Outbound dan Bin to Bin

$itemCode = sanitize($_GET['item_code'] ?? '');
$sourceBin = sanitize($_GET['source_bin'] ?? '');

if ($sourceBin === '' && $itemCode === '') {
    jsonResponse(['status' => 'error', 'message' => 'isi source bin atau item code terlebih dahulu'], 400);
    exit;
}

$db = new Database();
$conn = $db->getConnection();
$stock = new Stock($conn);

if ($sourceBin) {
    jsonResponse($stock->getStockByBin($sourceBin));
} else if ($itemCode) {
    jsonResponse($stock->getStockByItemCode($itemCode));
} else {
    jsonResponse(['status' => 'error', 'message' => 'isi source bin atau item code terlebih dahulu'], 400);
}