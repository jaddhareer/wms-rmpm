<?php

// Controller = urusan HTTP: baca request ($_GET), panggil model, kirim JSON.
// Semua urusan SQL ada di model Transactions.

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

$perPage = 50;

try {
    $db = new Database();
    $conn = $db->getConnection();

    $transactions = new Transactions($conn);

    // Mode detail: ?detail=RMPMIB26090001 -> semua baris milik kode itu (untuk popup).
    $detailCode = sanitize($_GET['detail'] ?? '');
    if ($detailCode !== '') {
        jsonResponse([
            'success' => true,
            'data'    => $transactions->findByCode($detailCode),
        ]);
    }

    // Mode daftar: ini request GET, jadi filter datang lewat URL ($_GET), bukan body JSON.
    $filters = [
        'code'        => sanitize($_GET['code'] ?? ''),
        'types'       => sanitize($_GET['types'] ?? ''),        // mis. "INBOUND,OUTBOUND"
        'description' => sanitize($_GET['description'] ?? ''),  // mis. "sodium, sticker"
        'source'      => sanitize($_GET['source'] ?? ''),
        'destination' => sanitize($_GET['destination'] ?? ''),
        'date_from'   => sanitize($_GET['date_from'] ?? ''),
        'time_from'   => sanitize($_GET['time_from'] ?? ''),
        'date_to'     => sanitize($_GET['date_to'] ?? ''),
        'time_to'     => sanitize($_GET['time_to'] ?? ''),
    ];

    $total = $transactions->countAll($filters);
    $totalPages = max(1, (int) ceil($total / $perPage));

    // Halaman di luar jangkauan dikembalikan ke batas terdekat.
    $page = min(max(1, (int) ($_GET['page'] ?? 1)), $totalPages);

    $rows = $transactions->search($filters, $perPage, ($page - 1) * $perPage);

    jsonResponse([
        'success'    => true,
        'data'       => $rows,
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