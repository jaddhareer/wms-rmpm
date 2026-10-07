<?php

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

requireLogin(); // belum login -> 401 dan berhenti di sini

$itemCode = sanitize($_GET['item_code'] ?? '');
$expDate = sanitize($_GET['exp_date'] ?? '');

if($itemCode === '' || $expDate === ''){
    http_response_code(400);
    echo json_encode(['error' => 'item_code dan exp_date harus diisi']);
    exit;
}

$db = new Database();
$conn = $db->getConnection();

$palletNumber = generatePalletNumber($conn, $itemCode, $expDate);

echo json_encode(['pallet_number' => $palletNumber]);
