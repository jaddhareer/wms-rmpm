<?php

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

$itemCode = sanitize($_GET['item_code'] ?? '');

if ($itemCode === '') {
    jsonResponse(['error' => 'Item Code wajib diisi'], 400);
}

$db = new Database();
$conn = $db->getConnection();

$material = new Material($conn);
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