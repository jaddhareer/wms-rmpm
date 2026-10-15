<?php

// Retur: barang yang sudah di-OUTBOUND kembali ke gudang, ke nomor pallet asalnya.
//   GET  ?code=RMPMOB...  -> pallet-pallet dokumen itu + sisa yang boleh diretur
//   POST (JSON)           -> simpan retur
//
// Bentuk body POST (JSON "object berisi array"):
// {
//   "reference_code": "RMPMOB26090007",
//   "remark": "catatan operator (opsional)",
//   "items": [ { "item_code", "exp_date", "pallet_number", "qty_actual", "bin" }, ... ]
// }
//
// Retur sebagian unit (mis. keluar 1 ROLL = 36,666 KG, kembali hanya 10 KG):
// item boleh dikirim dalam UoM SAP -> { ..., "input_unit": "sap", "qty_sap": 10 } (qty_actual diabaikan).
// qty SAP dicatat persis seperti yang ditimbang, qty fisik diturunkan = qty_sap / faktor pallet.

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

// Belum login -> 401, role tanpa menu 'retur' -> 403. $userId dicatat di ledger sebagai pelaku transaksi.
$userId = requireLogin('retur');

$db = new Database();
$conn = $db->getConnection();

$transactions = new Transactions($conn);

// ---------------------------------------------------------
// GET: muat dokumen outbound
// ---------------------------------------------------------
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $code = strtoupper(sanitize($_GET['code'] ?? ''));

    if ($code === '') {
        jsonResponse(['success' => false, 'error' => 'ID transaksi outbound wajib diisi'], 400);
    }

    $lines = $transactions->findReturnable($code);
    if (!$lines) {
        jsonResponse(['success' => false, 'error' => "Transaksi outbound $code tidak ditemukan"], 404);
    }

    jsonResponse(['success' => true, 'reference_code' => $code, 'data' => $lines]);
}

// ---------------------------------------------------------
// POST: simpan retur
// ---------------------------------------------------------
$body = readJsonBody();

$referenceCode = strtoupper(sanitize($body['reference_code'] ?? ''));
$operatorRemark = sanitize($body['remark'] ?? '');
$items = is_array($body['items'] ?? null) ? $body['items'] : [];

if ($referenceCode === '' || count($items) === 0) {
    jsonResponse(['success' => false, 'error' => 'ID transaksi outbound dan daftar pallet wajib diisi'], 400);
}

$remark = "Retur dari transaksi $referenceCode" . ($operatorRemark !== '' ? " - $operatorRemark" : '');

try {
    $conn->beginTransaction();

    // Dokumen outbound dibaca di DALAM transaction, jadi angka "sudah diretur"
    // yang dipakai untuk validasi adalah angka terbaru.
    $lines = $transactions->findReturnable($referenceCode);
    if (!$lines) {
        throw new Exception("Transaksi outbound $referenceCode tidak ditemukan");
    }

    // Peta: "item|exp|pallet" -> baris dokumen. Dipakai untuk cek pallet & batas qty.
    $lineMap = [];
    foreach ($lines as $line) {
        $lineMap[$line['item_code'] . '|' . $line['exp_date'] . '|' . $line['pallet_number']] = $line;
    }

    // Retur yang sudah diproses di submit INI (kalau pallet sama muncul lebih dari sekali).
    $returnedNow = [];      // qty fisik
    $returnedSapNow = [];   // qty SAP

    $transactionCode = generateTxnId($conn, 'RETUR');

    foreach ($items as $index => $item) {
        $row = $index + 1;

        $itemCode     = sanitize($item['item_code'] ?? '');
        $expDate      = sanitize($item['exp_date'] ?? '');
        $palletNumber = (int) ($item['pallet_number'] ?? 0);
        $qtyActual    = (float) ($item['qty_actual'] ?? 0);
        $inSapUnit    = ($item['input_unit'] ?? '') === 'sap';
        $qtySapInput  = round((float) ($item['qty_sap'] ?? 0), QTY_SAP_DECIMALS);
        $binInput     = strtoupper(sanitize($item['bin'] ?? ''));

        $key = "$itemCode|$expDate|$palletNumber";

        // 1. Pallet harus memang ada di dokumen outbound ini.
        if (!isset($lineMap[$key])) {
            throw new Exception("Baris $row: pallet $palletNumber ($itemCode, exp $expDate) tidak ada di transaksi $referenceCode");
        }
        if (($inSapUnit ? $qtySapInput : $qtyActual) <= 0) {
            throw new Exception("Baris $row: quantity harus lebih dari 0");
        }

        // 2. Total retur tidak boleh melebihi qty yang keluar (dicek di satuan yang diisi operator).
        $line = $lineMap[$key];
        $remaining    = round((float) $line['qty_out'] - (float) $line['qty_returned'] - ($returnedNow[$key] ?? 0), 3);
        $remainingSap = round((float) $line['sap_out'] - (float) $line['sap_returned'] - ($returnedSapNow[$key] ?? 0), QTY_SAP_DECIMALS);
        if ($inSapUnit && $qtySapInput > $remainingSap + 0.00005) {
            throw new Exception("Baris $row: retur pallet $palletNumber maksimal " . formatQtySap($remainingSap) . " {$line['uom_sap']} (keluar " . formatQtySap($line['sap_out']) . ", sudah diretur " . formatQtySap($line['sap_returned']) . ")");
        }
        if (!$inSapUnit && $qtyActual > $remaining + 0.0005) {
            throw new Exception("Baris $row: retur pallet $palletNumber maksimal " . formatNumber($remaining) . " {$line['uom_fisik']} (keluar " . formatNumber($line['qty_out']) . ", sudah diretur " . formatNumber($line['qty_returned']) . ")");
        }

        // 3. Kondisi pallet sekarang (dikunci sampai commit).
        $stock = new Stock($conn);
        $stock->setItemCode($itemCode);
        $stock->setExpDate($expDate);
        $stock->setPalletNumber($palletNumber);

        $pallet = $stock->findPallet();
        if (!$pallet) {
            throw new Exception("Baris $row: pallet $palletNumber tidak ditemukan di tabel stock");
        }

        // 4. Aturan bin:
        //    - pallet sudah kosong (qty 0) -> bin wajib diisi, pallet "hidup lagi" di bin baru
        //    - pallet masih ada isinya     -> barang ditaruh ke pallet yang sama, bin tidak berubah
        $palletWasEmpty = (float) $pallet['qty_actual'] <= 0;
        if ($palletWasEmpty && $binInput === '') {
            throw new Exception("Baris $row: pallet $palletNumber sudah kosong, bin tujuan wajib diisi");
        }
        $newBin = $palletWasEmpty ? $binInput : null;
        $finalBin = $palletWasEmpty ? $binInput : $pallet['bin'];

        // 5. Pasangan qty fisik & qty SAP. Faktor konversi = milik pallet itu sendiri.
        $factor = (float) $pallet['conversion_factor'];
        if ($inSapUnit) {
            // Diisi dalam UoM SAP (hasil timbang): qty SAP dicatat apa adanya, qty fisik diturunkan.
            // Kalau yang kembali = semua sisa, qty fisik = sisa persis (tidak ada selisih pembulatan).
            $qtySap = $qtySapInput;
            $isAllRemaining = abs($qtySap - $remainingSap) < 0.00005;
            $qtyActual = $isAllRemaining ? $remaining : min(round($qtySap / $factor, 3), $remaining);
            if ($qtyActual <= 0) {
                throw new Exception("Baris $row: qty " . formatQtySap($qtySap) . " {$line['uom_sap']} terlalu kecil (kurang dari 0,001 {$line['uom_fisik']})");
            }
        } else {
            // Diisi dalam UoM fisik: qty SAP dihitung qty x faktor, seperti Inbound/Outbound.
            // Kalau yang kembali = semua sisa, qty SAP = sisa SAP persis, supaya total retur
            // sama dengan total keluar walaupun retur sebelumnya diisi dalam UoM SAP.
            $isAllRemaining = abs($qtyActual - $remaining) < 0.0005;
            $qtySap = $isAllRemaining ? $remainingSap : min(calculateQtySap($qtyActual, $factor), $remainingSap);
        }

        $stock->setQtyActual($qtyActual);
        $stock->setQtySap($qtySap);
        if (!$stock->stockReturn($newBin)) {
            throw new Exception("Baris $row: gagal memperbarui stok pallet $palletNumber");
        }

        // 6. Ledger RETUR, dengan reference_code ke dokumen outbound asal.
        $ledger = new Transactions($conn);
        $ledger->setTransactionCode($transactionCode);
        $ledger->setTransactionType('RETUR');
        $ledger->setReferenceCode($referenceCode);
        $ledger->setItemCode($itemCode);
        $ledger->setExpDate($expDate);
        $ledger->setPalletNumber($palletNumber);
        $ledger->setQtyActual($qtyActual);
        $ledger->setQtySap($qtySap);
        $ledger->setSource($line['destination']);   // PRODUKSI / QUALITY / OTHER, dari dokumen outbound
        $ledger->setDestinationBin($finalBin);
        $ledger->setUserId($userId);
        $ledger->setRemark($remark);
        $ledger->save();

        $returnedNow[$key] = ($returnedNow[$key] ?? 0) + $qtyActual;
        $returnedSapNow[$key] = ($returnedSapNow[$key] ?? 0) + $qtySap;
    }

    $conn->commit();

    jsonResponse(['success' => true, 'transaction_code' => $transactionCode]);

} catch (Exception $e) {
    if ($conn->inTransaction()) {
        $conn->rollBack();
    }
    jsonResponse(['success' => false, 'error' => $e->getMessage()], 400);
}
