<?php

// Zona waktu PHP disamakan dengan gudang. Default XAMPP adalah Europe/Berlin, yang
// membuat date() (mis. bulan di kode transaksi RMPMIB2610...) bisa meleset dini hari.
date_default_timezone_set('Asia/Jakarta');

require_once __DIR__ . '/database.php';
require_once __DIR__ . '/helper.php';

require_once dirname(__DIR__) . '/library/XlsxWriter.php';

require_once dirname(__DIR__) . '/model/Stock.php';
require_once dirname(__DIR__) . '/model/Transactions.php';
require_once dirname(__DIR__) . '/model/Material.php';
require_once dirname(__DIR__) . '/model/Dashboard.php';
