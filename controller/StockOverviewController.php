<?php

// Halaman Stock Overview. Tiga mode dalam satu controller:
//   ?export=1                          -> download Excel (semua pallet sesuai filter)
//   ?detail_item=...&detail_exp=...    -> daftar pallet satu lot (popup)
//   (selain itu)                       -> satu halaman ringkasan per lot

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

requireLogin(); // belum login -> 401 dan berhenti di sini

$perPage = 15;

try {
    $db = new Database();
    $conn = $db->getConnection();

    $stock = new Stock($conn);

    $filters = [
        'description' => sanitize($_GET['description'] ?? ''),  // mis. "sodium, sticker"
        'exp_from'    => sanitize($_GET['exp_from'] ?? ''),
        'exp_to'      => sanitize($_GET['exp_to'] ?? ''),
        'bin'         => sanitize($_GET['bin'] ?? ''),
    ];

    // --- Mode export ---
    if (($_GET['export'] ?? '') === '1') {
        $rows = $stock->searchPallets($filters);

        $xlsx = new XlsxWriter('Stock');
        $xlsx->setHeaders([
            'Item Code', 'Description', 'Exp Date', 'Pallet', 'Bin',
            'Qty', 'UoM', 'Conversion Factor', 'Qty SAP', 'UoM SAP', 'Remark', 'Last Update',
        ]);

        // Angka dari PDO datang sebagai string ("10.000"). Diubah ke float/int supaya
        // di Excel jadi sel angka yang bisa dijumlah, bukan teks.
        foreach ($rows as $r) {
            $xlsx->addRow([
                $r['item_code'],
                $r['description'],
                $r['exp_date'],
                (int) $r['pallet_number'],
                $r['bin'],
                (float) $r['qty_actual'],
                $r['uom_fisik'],
                (float) $r['conversion_factor'],
                (float) $r['qty_sap'],
                $r['uom_sap'],
                $r['remark'],
                $r['updated_at'],
            ]);
        }

        $xlsx->download('stock-rmpm-' . date('Ymd-His') . '.xlsx'); // exit di dalamnya
    }

    // --- Mode detail ---
    $detailItem = sanitize($_GET['detail_item'] ?? '');
    $detailExp  = sanitize($_GET['detail_exp'] ?? '');
    if ($detailItem !== '' && $detailExp !== '') {
        jsonResponse([
            'success' => true,
            'data'    => $stock->findLotPallets($filters, $detailItem, $detailExp),
        ]);
    }

    // --- Mode daftar ---
    $total = $stock->countLots($filters);
    $totalPages = max(1, (int) ceil($total / $perPage));
    $page = min(max(1, (int) ($_GET['page'] ?? 1)), $totalPages);

    jsonResponse([
        'success'    => true,
        'data'       => $stock->searchLots($filters, $perPage, ($page - 1) * $perPage),
        'pagination' => [
            'page'        => $page,
            'per_page'    => $perPage,
            'total'       => $total,
            'total_pages' => $totalPages,
        ],
    ]);

} catch (Exception $e) {
    jsonResponse(['success' => false, 'error' => $e->getMessage()], 500);
}
