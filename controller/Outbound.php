<?php

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

// Belum login -> 401 dan berhenti di sini. $userId dicatat di ledger sebagai pelaku transaksi.
$userId = requireLogin();

$items = readJsonBody();

if (count($items) === 0) {
    jsonResponse(['success' => false, 'error' => 'Tidak ada data pallet yang dikirim'], 400);
}

$db = new Database();
$conn = $db->getConnection();

$allowedDestinations = ['PRODUKSI', 'QUALITY'];

try {
    $conn->beginTransaction();

    $transactionCode = generateTxnId($conn, 'OUTBOUND');

    foreach ($items as $index => $item) {
        $row = $index + 1;

        // Dari operator cukup: identitas pallet, qty, tujuan, remark.
        // Sisanya (bin asal, sisa stok) dibaca dari database.
        $itemCode     = sanitize($item['item_code'] ?? '');
        $expDate      = sanitize($item['exp_date'] ?? '');
        $palletNumber = (int) ($item['pallet_number'] ?? 0);
        $qtyActual    = (float) ($item['qty_actual'] ?? 0);
        $destination  = strtoupper(sanitize($item['destination'] ?? ''));
        $remark       = sanitize($item['remark'] ?? '');

        if ($itemCode === '' || $expDate === '' || $palletNumber <= 0) {
            throw new Exception("Baris $row: identitas pallet tidak lengkap");
        }
        if ($qtyActual <= 0) {
            throw new Exception("Baris $row: quantity harus lebih dari 0");
        }
        if (!in_array($destination, $allowedDestinations, true)) {
            throw new Exception("Baris $row: tujuan harus PRODUKSI atau QUALITY");
        }

        $stock = new Stock($conn);
        $stock->setItemCode($itemCode);
        $stock->setExpDate($expDate);
        $stock->setPalletNumber($palletNumber);

        $pallet = $stock->findPallet();
        if (!$pallet) {
            throw new Exception("Baris $row: pallet $palletNumber ($itemCode, exp $expDate) tidak ditemukan");
        }

        // Pakai faktor milik pallet ini (yang dicatat saat inbound), bukan default master.
        $qtySap = round($qtyActual * (float) $pallet['conversion_factor'], 3);

        $stock->setQtyActual($qtyActual);
        $stock->setQtySap($qtySap);

        // Pengaman utama tetap syarat qty_actual >= ? di dalam UPDATE.
        // Pallet yang sudah habis tetap ada (qty 0), jadi akan gagal di sini dengan "sisa 0".
        if (!$stock->stockout()) {
            throw new Exception("Baris $row: stok pallet $palletNumber tidak cukup (sisa {$pallet['qty_actual']})");
        }

        $transaction = new Transactions($conn);
        $transaction->setTransactionCode($transactionCode);
        $transaction->setTransactionType('OUTBOUND');
        $transaction->setItemCode($itemCode);
        $transaction->setExpDate($pallet['exp_date']);
        $transaction->setPalletNumber($palletNumber);
        $transaction->setQtyActual($qtyActual);
        $transaction->setQtySap($qtySap);
        $transaction->setSourceBin($pallet['bin']);   // bin asal, dari database
        $transaction->setDestination($destination);
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