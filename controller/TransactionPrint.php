<?php

// Halaman cetak satu dokumen transaksi (dibuka di tab baru dari popup detail transaksi).
//
// Berbeda dengan controller lain yang membalas JSON, controller ini membalas HTML.
// Pembagian tugasnya tetap MVC:
//   model      -> Transactions::findByCode()  (SQL)
//   controller -> file ini: baca ?code=, ambil data, susun ringkasan, pilih label dokumen
//   view       -> view/transaction_print.php  (HTML saja, tidak ada SQL)

require_once dirname(__DIR__) . '/config/bootstrap.php';

// Judul dokumen & label tanda tangan per jenis transaksi.
// Ubah di sini kalau istilah di lapangan berbeda.
const PRINT_DOCS = [
    'INBOUND' => [
        'title' => 'Bukti Penerimaan Barang (Inbound)',
        'signs' => [
            ['label' => 'Diserahkan oleh', 'role' => 'Supplier / Pengirim'],
            ['label' => 'Diterima oleh',   'role' => 'Staff Gudang'],
        ],
    ],
    'OUTBOUND' => [
        'title' => 'Bukti Pengeluaran Barang (Outbound)',
        'signs' => [
            ['label' => 'Diserahkan oleh', 'role' => 'Staff Gudang'],
            ['label' => 'Diterima oleh',   'role' => 'Produksi / Quality'],
        ],
    ],
    'RETUR' => [
        'title' => 'Bukti Retur Barang',
        'signs' => [
            ['label' => 'Diserahkan oleh', 'role' => 'Produksi / Quality'],
            ['label' => 'Diterima oleh',   'role' => 'Staff Gudang'],
        ],
    ],
    'MUTASI' => [
        'title' => 'Bukti Mutasi Bin (Bin to Bin)',
        'signs' => [
            ['label' => 'Dipindahkan oleh', 'role' => 'Staff Gudang'],
            ['label' => 'Diperiksa oleh',   'role' => 'Supervisor'],
        ],
    ],
];

$code = strtoupper(sanitize($_GET['code'] ?? ''));

$db = new Database();
$conn = $db->getConnection();

$transactions = new Transactions($conn);
$rows = $code !== '' ? $transactions->findByCode($code) : [];

if (!$rows) {
    http_response_code(404);
    exit('Transaksi ' . e($code) . ' tidak ditemukan.');
}

// Semua baris satu dokumen punya jenis, user, dan waktu yang sama.
$head = $rows[0];
$doc  = PRINT_DOCS[$head['transaction_type']];

// Ringkasan per lot (item_code + exp_date): jumlah pallet, total qty, total qty SAP.
$summary = [];
foreach ($rows as $row) {
    $key = $row['item_code'] . '|' . $row['exp_date'];

    if (!isset($summary[$key])) {
        $summary[$key] = [
            'item_code'   => $row['item_code'],
            'description' => $row['description'],
            'exp_date'    => $row['exp_date'],
            'uom_fisik'   => $row['uom_fisik'],
            'uom_sap'     => $row['uom_sap'],
            'pallets'     => 0,
            'qty_actual'  => 0,
            'qty_sap'     => 0,
        ];
    }

    $summary[$key]['pallets']++;
    $summary[$key]['qty_actual'] += (float) $row['qty_actual'];
    $summary[$key]['qty_sap']    += (float) $row['qty_sap'];
}

// Remark: kalau semua baris remark-nya sama (mis. retur), cukup tampil sekali di kepala
// dokumen. Kalau berbeda-beda per pallet, tampil sebagai kolom di tabel detail.
$remarks = array_unique(array_map(fn($r) => (string) $r['remark'], $rows));
$commonRemark = count($remarks) === 1 ? reset($remarks) : null;

// Kolom Dari/Ke sama seperti di layar Histori Transaksi: bin kalau ada, kalau tidak teksnya.
$fromOf = fn($r) => $r['source_bin'] ?: ($r['source'] ?: '-');
$toOf   = fn($r) => $r['destination_bin'] ?: ($r['destination'] ?: '-');

require dirname(__DIR__) . '/view/transaction_print.php';
