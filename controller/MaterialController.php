<?php

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

$db = new Database();
$conn = $db->getConnection();

$material = new Material($conn);

$material->setItemCode(sanitize($_GET['item_code'] ?? ''));
$material->selectMaterial();

echo json_encode([
    'item_code' => $material->getItemCode(),
    'item_name' => $material->getItemName(),
    'uom_fisik' => $material->getUomFisik(),
    'uom_sap' => $material->getUomSap(),
    'conversion_factor' => $material->getConversionFactor()
]);