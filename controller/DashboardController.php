<?php

// Dashboard: okupansi saat ini + jumlah pergerakan inbound/outbound per periode
// + riwayat okupansi harian.
//   GET ?period=daily|weekly|monthly|yearly   (grafik batang, default daily)
//       &range=week|month|year                (grafik garis: 7 / 30 / 365 hari, default month)

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

requireLogin('dashboard'); // belum login -> 401, role tanpa menu 'dashboard' -> 403

$allowedPeriods = ['daily', 'weekly', 'monthly', 'yearly'];
$rangeDays = ['week' => 7, 'month' => 30, 'year' => 365];

$period = sanitize($_GET['period'] ?? 'daily');
if (!in_array($period, $allowedPeriods, true)) {
    $period = 'daily';
}

$range = sanitize($_GET['range'] ?? 'month');
$days = $rangeDays[$range] ?? 30;

try {
    $db = new Database();
    $conn = $db->getConnection();

    $dashboard = new Dashboard($conn);

    jsonResponse([
        'success'   => true,
        'occupancy' => $dashboard->occupancy(),
        'movements' => $dashboard->movements($period),
        'trend'     => $dashboard->occupancyTrend($days),
    ]);

} catch (Exception $e) {
    jsonResponse(['success' => false, 'error' => $e->getMessage()], 500);
}
