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
// Unit tidak utuh (mis. keluar 10 ROLL @ 35,5 KG, kembali 5 ROLL utuh + 3 ROLL kecil 1,2 / 1,1 / 1,2 KG):
// yang utuh dikirim seperti biasa (qty_actual = 5) dan kembali ke pallet asal. Setiap unit tidak utuh
// dikirim SATU item sendiri dalam UoM SAP -> { ..., "input_unit": "sap", "qty_sap": 1.2 } (qty_actual
// diabaikan), beratnya harus kurang dari 1 unit (faktor pallet asal).
//
// Unit tidak utuh TIDAK masuk pallet asal, karena faktor konversi disimpan per pallet: kalau masuk,
// outbound berikutnya akan menghitung 1 ROLL kecil = 35,5 KG. Semua unit tidak utuh dari satu pallet
// asal di satu submit masuk SATU pallet sisa (nomor pallet baru, item & exp sama, bin sama dengan
// pallet asal): qty = jumlah unit, qty SAP = total berat, faktor = rata-rata berat per unit.
// Di ledger tetap satu baris per unit (qty 1, qty SAP = beratnya): pallet_number = pallet asal
// (supaya batas retur dokumen outbound tetap terhitung), destination_pallet = pallet sisa, dan remark
// diawali RETUR_PARTIAL_MARK supaya unit tidak utuh bisa dihitung dari Histori / export.

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

// Belum login -> 401, role tanpa menu 'retur' -> 403. $userId dicatat di ledger sebagai pelaku transaksi.
$userId = requireLogin('retur');

// Penanda di awal remark baris unit tidak utuh (dan remark stok pallet sisa).
// Jangan diubah: dipakai untuk filter laporan.
const RETUR_PARTIAL_MARK = '[TIDAK UTUH]';

// Remark ledger VARCHAR(255) = penanda + "Retur dari transaksi RMPMOB........ - " + catatan operator.
const RETUR_REMARK_MAX = 200;

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
if (mb_strlen($operatorRemark) > RETUR_REMARK_MAX) {
    jsonResponse(['success' => false, 'error' => 'Remark maksimal ' . RETUR_REMARK_MAX . ' karakter'], 400);
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

    // Unit tidak utuh per pallet asal, dibuatkan pallet sisa setelah semua baris dicek.
    $partialGroups = [];    // "item|exp|pallet" -> ['line', 'bin_input', 'weights' => [...]]

    $transactionCode = generateTxnId($conn, 'RETUR');

    foreach ($items as $index => $item) {
        $row = $index + 1;

        $itemCode     = sanitize($item['item_code'] ?? '');
        $expDate      = sanitize($item['exp_date'] ?? '');
        $palletNumber = (int) ($item['pallet_number'] ?? 0);
        $qtyActual    = (float) ($item['qty_actual'] ?? 0);
        $isPartial    = ($item['input_unit'] ?? '') === 'sap';
        $weight       = round((float) ($item['qty_sap'] ?? 0), QTY_SAP_DECIMALS);
        $binInput     = strtoupper(sanitize($item['bin'] ?? ''));

        $key = "$itemCode|$expDate|$palletNumber";

        // 1. Pallet harus memang ada di dokumen outbound ini.
        if (!isset($lineMap[$key])) {
            throw new Exception("Baris $row: pallet $palletNumber ($itemCode, exp $expDate) tidak ada di transaksi $referenceCode");
        }
        if (($isPartial ? $weight : $qtyActual) <= 0) {
            throw new Exception("Baris $row: quantity harus lebih dari 0");
        }

        // Unit tidak utuh dihitung 1 unit fisik; beratnya di qty SAP.
        if ($isPartial) {
            $qtyActual = 1;
        }

        // 2. Total retur tidak boleh melebihi yang keluar, dalam unit fisik DAN qty SAP.
        $line = $lineMap[$key];
        $remaining    = round((float) $line['qty_out'] - (float) $line['qty_returned'] - ($returnedNow[$key] ?? 0), 3);
        $remainingSap = round((float) $line['sap_out'] - (float) $line['sap_returned'] - ($returnedSapNow[$key] ?? 0), QTY_SAP_DECIMALS);
        if ($qtyActual > $remaining + 0.0005) {
            throw new Exception("Baris $row: retur pallet $palletNumber maksimal " . formatNumber($remaining) . " {$line['uom_fisik']} (keluar " . formatNumber($line['qty_out']) . ", sudah diretur " . formatNumber($line['qty_returned']) . ")");
        }
        if ($isPartial && $weight > $remainingSap + 0.00005) {
            throw new Exception("Baris $row: retur pallet $palletNumber maksimal " . formatQtySap($remainingSap) . " {$line['uom_sap']} (keluar " . formatQtySap($line['sap_out']) . ", sudah diretur " . formatQtySap($line['sap_returned']) . ")");
        }

        // 3. Kondisi pallet asal sekarang (dikunci sampai commit).
        $stock = new Stock($conn);
        $stock->setItemCode($itemCode);
        $stock->setExpDate($expDate);
        $stock->setPalletNumber($palletNumber);

        $pallet = $stock->findPallet();
        if (!$pallet) {
            throw new Exception("Baris $row: pallet $palletNumber tidak ditemukan di tabel stock");
        }
        $factor = (float) $pallet['conversion_factor'];

        // 4a. Unit tidak utuh: dicek, lalu dikumpulkan. Pallet sisanya dibuat setelah loop.
        if ($isPartial) {
            if ($weight >= $factor) {
                throw new Exception("Baris $row: {$line['uom_fisik']} tidak utuh harus kurang dari 1 {$line['uom_fisik']} ("
                    . formatQtySap($factor) . " {$line['uom_sap']}). {$line['uom_fisik']} utuh diisi di Qty Retur Utuh.");
            }

            $partialGroups[$key] ??= ['line' => $line, 'bin_input' => '', 'weights' => []];
            $partialGroups[$key]['weights'][] = $weight;
            if ($partialGroups[$key]['bin_input'] === '') {
                $partialGroups[$key]['bin_input'] = $binInput;
            }

            $returnedNow[$key] = ($returnedNow[$key] ?? 0) + 1;
            $returnedSapNow[$key] = ($returnedSapNow[$key] ?? 0) + $weight;
            continue;
        }

        // 4b. Unit utuh kembali ke pallet asal. Aturan bin:
        //    - pallet sudah kosong (qty 0) -> bin wajib diisi, pallet "hidup lagi" di bin baru
        //    - pallet masih ada isinya     -> barang ditaruh ke pallet yang sama, bin tidak berubah
        $palletWasEmpty = (float) $pallet['qty_actual'] <= 0;
        if ($palletWasEmpty && $binInput === '') {
            throw new Exception("Baris $row: pallet $palletNumber sudah kosong, bin tujuan wajib diisi");
        }
        $newBin = $palletWasEmpty ? $binInput : null;
        $finalBin = $palletWasEmpty ? $binInput : $pallet['bin'];

        // 5. qty SAP = qty x faktor pallet, seperti Inbound/Outbound. Kalau yang kembali = semua sisa
        //    dan bedanya hanya selisih pembulatan (qty fisik 3 desimal), qty SAP = sisa SAP persis.
        //    Kalau sebagian sudah kembali sebagai unit tidak utuh (1 unit, berat < faktor), sisa SAP
        //    memang lebih besar dari sisa unit x faktor, dan unit utuh tetap dihitung qty x faktor.
        $calculated = calculateQtySap($qtyActual, $factor);
        $isAllRemaining = abs($qtyActual - $remaining) < 0.0005
            && abs($remainingSap - $calculated) <= 0.0005 * $factor + 0.00005;
        $qtySap = $isAllRemaining ? $remainingSap : min($calculated, $remainingSap);

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

    // 7. Pallet sisa: satu per pallet asal, berisi semua unit tidak utuh pallet itu.
    $sisaInfo = [];
    foreach ($partialGroups as $group) {
        $line = $group['line'];
        $itemCode = $line['item_code'];
        $expDate = $line['exp_date'];

        // Pallet asal dibaca lagi: bisa baru terisi lagi oleh baris utuh di atas (bin baru).
        $origin = new Stock($conn);
        $origin->setItemCode($itemCode);
        $origin->setExpDate($expDate);
        $origin->setPalletNumber($line['pallet_number']);
        $pallet = $origin->findPallet();

        // Bin sama dengan pallet asal. Pallet asal kosong -> bin yang diisi operator.
        if ((float) $pallet['qty_actual'] > 0) {
            $bin = $pallet['bin'];
        } elseif ($group['bin_input'] !== '') {
            $bin = $group['bin_input'];
        } else {
            throw new Exception("Pallet {$line['pallet_number']} ($itemCode) sudah kosong, bin tujuan wajib diisi");
        }

        $count = count($group['weights']);
        $totalSap = round(array_sum($group['weights']), QTY_SAP_DECIMALS);
        $sisaPallet = generatePalletNumber($conn, $itemCode, $expDate);

        $sisa = new Stock($conn);
        $sisa->setItemCode($itemCode);
        $sisa->setExpDate($expDate);
        $sisa->setPalletNumber($sisaPallet);
        $sisa->setSupplier($pallet['supplier']);
        $sisa->setBin($bin);
        $sisa->setQtyActual($count);
        $sisa->setConversionFactor(round($totalSap / $count, 4));   // rata-rata berat per unit
        $sisa->setQtySap($totalSap);                                // total berat persis
        $sisa->setRemark(RETUR_PARTIAL_MARK . " Retur $transactionCode dari pallet {$line['pallet_number']}");
        $sisa->stockin();

        // Ledger: satu baris per unit, supaya berat tiap unit tetap tercatat.
        foreach ($group['weights'] as $weight) {
            $ledger = new Transactions($conn);
            $ledger->setTransactionCode($transactionCode);
            $ledger->setTransactionType('RETUR');
            $ledger->setReferenceCode($referenceCode);
            $ledger->setItemCode($itemCode);
            $ledger->setExpDate($expDate);
            $ledger->setPalletNumber($line['pallet_number']);   // pallet asal (dokumen outbound)
            $ledger->setDestinationPallet($sisaPallet);         // tempat barangnya sekarang
            $ledger->setQtyActual(1);
            $ledger->setQtySap($weight);
            $ledger->setSource($line['destination']);
            $ledger->setDestinationBin($bin);
            $ledger->setUserId($userId);
            $ledger->setRemark(RETUR_PARTIAL_MARK . ' ' . $remark);
            $ledger->save();
        }

        $sisaInfo[] = "$itemCode pallet $sisaPallet di $bin ($count {$line['uom_fisik']}, "
            . formatQtySap($totalSap) . " {$line['uom_sap']})";
    }

    $conn->commit();

    jsonResponse([
        'success' => true,
        'transaction_code' => $transactionCode,
        'message' => "Retur berhasil disimpan: $transactionCode."
            . ($sisaInfo ? ' Unit tidak utuh masuk ' . implode('; ', $sisaInfo) . '.' : ''),
    ]);

} catch (Exception $e) {
    if ($conn->inTransaction()) {
        $conn->rollBack();
    }
    jsonResponse(['success' => false, 'error' => $e->getMessage()], 400);
}
