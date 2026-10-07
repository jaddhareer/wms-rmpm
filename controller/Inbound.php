<?php

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

// Belum login -> 401, role tanpa menu 'inbound' -> 403. $userId dicatat di ledger sebagai pelaku transaksi.
$userId = requireLogin('inbound');

$items = readJsonBody();

if (count($items) === 0) {
    jsonResponse(['success' => false, 'error' => 'Tidak ada data pallet yang dikirim'], 400);
}

$db = new Database();
$conn = $db->getConnection();

// Satu submit = satu dokumen = satu database transaction.
// Kalau satu pallet gagal, semua di-rollback.
try {
    $conn->beginTransaction();

    $transactionCode = generateTxnId($conn, 'INBOUND');

    foreach ($items as $index => $item) {
        $row = $index + 1; // nomor baris untuk pesan error ke operator

        $itemCode  = sanitize($item['item_code'] ?? '');
        $expDate   = sanitize($item['exp_date'] ?? '');
        $source    = sanitize($item['source'] ?? '');
        $bin       = strtoupper(sanitize($item['bin'] ?? '')) ?: 'STAGE';
        $remark    = sanitize($item['remark'] ?? '');
        $qtyActual = (float) ($item['qty_actual'] ?? 0);
        $conversionFactor = (float) ($item['conversion_factor'] ?? 0);

        if ($itemCode === '' || $expDate === '') {
            throw new Exception("Baris $row: item code dan expired date wajib diisi");
        }
        if ($qtyActual <= 0) {
            throw new Exception("Baris $row: quantity harus lebih dari 0");
        }

        $material = new Material($conn);
        $material->setItemCode($itemCode);
        if (!$material->selectMaterial()) {
            throw new Exception("Baris $row: item code $itemCode tidak ada di material master");
        }

        // Faktor dari operator dipercaya (bisa beda dari default untuk barang tertentu).
        // Kalau kosong/tidak valid, pakai default material master.
        if ($conversionFactor <= 0) {
            $conversionFactor = (float) $material->getConversionFactor();
        }

        // qty_sap tetap dihitung di server dari faktor itu, bukan diambil mentah dari frontend.
        $qtySap = round($qtyActual * $conversionFactor, 3);

        // Nomor pallet dihitung ulang di server, pakai $conn yang sama.
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
        $transaction->setDestinationBin($bin);
        $transaction->setUserId($userId);
        $transaction->setRemark($remark);
        $transaction->save();
    }

    $conn->commit();

    jsonResponse(['success' => true, 'transaction_code' => $transactionCode]);

} catch (Exception $e) {
    if ($conn->inTransaction()) {
        $conn->rollBack();
    }
    jsonResponse(['success' => false, 'error' => $e->getMessage()], 400);
}