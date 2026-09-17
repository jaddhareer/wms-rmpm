<?php

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

$db = new Database();
$conn = $db->getConnection();

$itemCode = sanitize($_POST['item-code']);
$expDate = sanitize($_POST['exp-date']);
$palletNumber = sanitize($_POST['pallet-number']);
$qtyFisik = sanitize($_POST['qty-fisik']);
$uomFisik = sanitize($_POST['uom-fisik']);
$qtySap = sanitize($_POST['qty-sap']);
$uomSap = sanitize($_POST['uom-sap']);
$bin = sanitize($_POST['bin']);
$remark = sanitize($_POST['remark']);

$stock = new Stock($conn);

$stock->setItemCode($itemCode);
$stock->setExpDate($expDate);
$stock->setPalletNumber($palletNumber);
$stock->setQtyActual($qtyFisik);
$stock->setQtySap($qtySap);
$stock->setBin($bin);
$stock->setRemark($remark);

$stock->save();

echo json_encode(['success' => true]);