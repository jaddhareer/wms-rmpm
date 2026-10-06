<?php

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

$db = new Database();
$conn = $db->getConnection();

$material = new Material($conn);

// Mode 1: ?q=kata  -> daftar saran untuk autocomplete (cari di description & item code).
if (isset($_GET['q'])) {
    $keyword = sanitize($_GET['q']);

    // Terlalu pendek -> hasilnya terlalu banyak dan tidak berguna.
    if (strlen($keyword) < 2) {
        jsonResponse(['success' => true, 'data' => []]);
    }

    jsonResponse(['success' => true, 'data' => $material->search($keyword)]);
}

// Mode 2: ?item_code=xxx  -> satu material persis (dipakai saat item code di-scan/diketik penuh).
$itemCode = sanitize($_GET['item_code'] ?? '');

if ($itemCode === '') {
    jsonResponse(['error' => 'Item Code wajib diisi'], 400);
}

$material->setItemCode($itemCode);

if (!$material->selectMaterial()) {
    jsonResponse(['error' => "Item code $itemCode tidak ada di material master"], 404);
}

jsonResponse([
    'item_code'         => $material->getItemCode(),
    'item_name'         => $material->getItemName(),
    'uom_fisik'         => $material->getUomFisik(),
    'uom_sap'           => $material->getUomSap(),
    'conversion_factor' => $material->getConversionFactor(),
]);
