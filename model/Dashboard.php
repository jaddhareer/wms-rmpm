<?php

// Model untuk halaman Dashboard: okupansi per lokasi dan jumlah pergerakan pallet.
// Tidak punya tabel sendiri; membaca dari stock dan transactions.

class Dashboard {
    private $conn;

    // Lokasi penyimpanan dan kapasitasnya (jumlah posisi pallet).
    // Lokasi TIDAK disimpan di database: diturunkan dari nama bin, supaya bin tetap
    // satu-satunya sumber kebenaran. Ubah angka kapasitas di sini kalau layout gudang berubah.
    public const LOCATIONS = [
        'GUDANG_40' => ['label' => 'Gudang 40', 'capacity' => 369, 'racks' => ['A', 'B', 'C', 'D']],
        'GUDANG_50' => ['label' => 'Gudang 50', 'capacity' => 270,  'racks' => ['E', 'F']],
        'FLOOR_40'  => ['label' => 'Floor 40',  'capacity' => 50,   'bins'  => ['FLOOR 40']],
        'FLOOR_50'  => ['label' => 'Floor 50',  'capacity' => 20,   'bins'  => ['FLOOR 50']],
    ];

    // Bin yang memang tidak dihitung ke okupansi.
    private const EXCLUDED_BINS = ['STAGE'];

    public function __construct($conn) {
        $this->conn = $conn;
    }

    // Bin -> kunci lokasi. null kalau tidak dihitung (STAGE) atau tidak dikenal.
    // Floor dicek DULUAN, karena "FLOOR 40" juga diawali huruf F (huruf rak F).
    // Bin rak harus berpola "<huruf rak>-...", mis. "A-01-B-02"; salah ketik seperti
    // "FLOOR40" tidak akan diam-diam masuk ke rak F, tapi muncul sebagai bin tidak dikenal.
    public static function locationOf(string $bin): ?string {
        $bin = strtoupper(trim($bin));

        foreach (self::LOCATIONS as $key => $location) {
            if (in_array($bin, $location['bins'] ?? [], true)) {
                return $key;
            }
        }

        if (preg_match('/^([A-Z])-/', $bin, $m)) {
            foreach (self::LOCATIONS as $key => $location) {
                if (in_array($m[1], $location['racks'] ?? [], true)) {
                    return $key;
                }
            }
        }

        return null;
    }

    // Okupansi saat ini: jumlah pallet berisi (qty > 0) per lokasi.
    // Dua pallet bertumpuk di satu bin tetap dihitung dua posisi pallet.
    public function occupancy(): array {
        $stmt = $this->conn->query('SELECT bin, COUNT(*) AS pallets FROM stock WHERE qty_actual > 0 GROUP BY bin');

        $result = [];
        foreach (self::LOCATIONS as $key => $location) {
            $result[$key] = [
                'key'      => $key,
                'label'    => $location['label'],
                'capacity' => $location['capacity'],
                'pallets'  => 0,
                'racks'    => array_fill_keys($location['racks'] ?? [], 0),
            ];
        }

        $excluded = 0;
        $unknown = [];

        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $bin = strtoupper(trim($row['bin']));
            $pallets = (int) $row['pallets'];
            $key = self::locationOf($bin);

            if ($key !== null) {
                $result[$key]['pallets'] += $pallets;
                $rack = substr($bin, 0, 1);
                if (isset($result[$key]['racks'][$rack]) && !in_array($bin, self::LOCATIONS[$key]['bins'] ?? [], true)) {
                    $result[$key]['racks'][$rack] += $pallets;
                }
            } elseif (in_array($bin, self::EXCLUDED_BINS, true)) {
                $excluded += $pallets;
            } else {
                $unknown[] = ['bin' => $bin, 'pallets' => $pallets];
            }
        }

        foreach ($result as &$location) {
            $location['percent'] = round($location['pallets'] / $location['capacity'] * 100, 1);
        }
        unset($location);

        return [
            'locations'       => array_values($result),
            'stage_pallets'   => $excluded,
            'unknown_bins'    => $unknown,
        ];
    }

    // Okupansi akhir hari untuk $days hari terakhir, per lokasi.
    //
    // Tabel stock hanya menyimpan kondisi SEKARANG, jadi kondisi hari-hari sebelumnya
    // disusun ulang dengan "memutar ulang" ledger dari transaksi pertama: setiap baris
    // ledger membawa sendiri qty dan bin-nya (prinsip ledger = snapshot), sehingga posisi
    // tiap pallet di akhir hari mana pun bisa dihitung tanpa tabel tambahan.
    //
    //   INBOUND  -> qty bertambah, pallet ada di destination_bin
    //   OUTBOUND -> qty berkurang (bin tetap)
    //   MUTASI   -> pallet pindah ke destination_bin
    //   RETUR    -> qty bertambah, pallet ada di destination_bin
    public function occupancyTrend(int $days): array {
        $today = new DateTimeImmutable($this->conn->query('SELECT CURDATE()')->fetchColumn());
        $start = $today->modify('-' . ($days - 1) . ' day');

        $counts = array_fill_keys(array_keys(self::LOCATIONS), 0);   // jumlah pallet berisi per lokasi saat ini (dalam putaran ulang)
        $history = array_fill_keys(array_keys(self::LOCATIONS), array_fill(0, $days, 0));
        $pallets = [];                                                // "item|exp|pallet" => ['qty' => .., 'bin' => ..]
        $cursor = $start;                                             // hari pertama yang belum dicatat

        // Catat posisi akhir hari untuk semua hari sebelum $until (yang masih di rentang).
        $flushUntil = function (DateTimeImmutable $until) use (&$cursor, &$history, &$counts, $start, $today) {
            while ($cursor < $until && $cursor <= $today) {
                $index = (int) $start->diff($cursor)->days;
                foreach ($counts as $key => $n) {
                    $history[$key][$index] = $n;
                }
                $cursor = $cursor->modify('+1 day');
            }
        };

        $stmt = $this->conn->query(
            'SELECT item_code, exp_date, pallet_number, transaction_type, qty_actual, destination_bin,
                    DATE(created_at) AS day
             FROM transactions
             ORDER BY created_at ASC, id ASC'
        );

        // Dibaca baris per baris (bukan fetchAll), supaya hemat memori walau ledger sudah besar.
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $flushUntil(new DateTimeImmutable($row['day'])); // semua transaksi hari sebelumnya sudah diterapkan

            $key = $row['item_code'] . '|' . $row['exp_date'] . '|' . $row['pallet_number'];
            $before = $pallets[$key] ?? ['qty' => 0.0, 'bin' => null];
            $after = $before;
            $qty = (float) $row['qty_actual'];

            switch ($row['transaction_type']) {
                case 'INBOUND':
                case 'RETUR':
                    $after['qty'] += $qty;
                    $after['bin'] = $row['destination_bin'] ?: $after['bin'];
                    break;
                case 'OUTBOUND':
                    $after['qty'] -= $qty;
                    break;
                case 'MUTASI':
                    $after['bin'] = $row['destination_bin'] ?: $after['bin'];
                    break;
            }

            $this->countPallet($counts, $before, -1);
            $this->countPallet($counts, $after, +1);
            $pallets[$key] = $after;
        }

        $flushUntil($today->modify('+1 day'));

        // Cek silang: hasil putar ulang hari ini harus sama dengan tabel stock.
        // Kalau beda, berarti ada data stok yang berubah tanpa lewat transaksi.
        $current = [];
        foreach ($this->occupancy()['locations'] as $location) {
            $current[$location['key']] = $location['pallets'];
        }
        $mismatch = [];
        foreach ($counts as $key => $n) {
            if ($n !== $current[$key]) {
                $mismatch[] = self::LOCATIONS[$key]['label'] . " (riwayat $n, stok {$current[$key]})";
            }
        }

        $labels = [];
        for ($d = $start; $d <= $today; $d = $d->modify('+1 day')) {
            $labels[] = $d->format('d/m/y');
        }

        $series = [];
        foreach (self::LOCATIONS as $key => $location) {
            $series[] = [
                'key'      => $key,
                'label'    => $location['label'],
                'capacity' => $location['capacity'],
                'pallets'  => $history[$key],
                'percent'  => array_map(fn($n) => round($n / $location['capacity'] * 100, 1), $history[$key]),
            ];
        }

        return ['days' => $days, 'labels' => $labels, 'series' => $series, 'mismatch' => $mismatch];
    }

    // Tambah/kurangi hitungan lokasi untuk satu pallet, kalau pallet itu berisi dan lokasinya dihitung.
    private function countPallet(array &$counts, array $pallet, int $delta): void {
        if ($pallet['qty'] <= 0.0005 || $pallet['bin'] === null) {
            return;
        }
        $key = self::locationOf($pallet['bin']);
        if ($key !== null) {
            $counts[$key] += $delta;
        }
    }

    // Jumlah baris ledger INBOUND dan OUTBOUND per periode.
    // Satu baris ledger = satu pallet yang bergerak (outbound sebagian tetap dihitung satu).
    //   daily   -> 14 hari terakhir     weekly  -> 12 minggu terakhir (Senin-Minggu)
    //   monthly -> 12 bulan terakhir    yearly  -> 5 tahun terakhir
    public function movements(string $period): array {
        // "Hari ini" diambil dari database, bukan dari PHP, supaya tanggalnya sama persis
        // dengan created_at di tabel (zona waktu PHP di XAMPP bisa berbeda dari MySQL).
        $today = new DateTimeImmutable($this->conn->query('SELECT CURDATE()')->fetchColumn());

        $buckets = $this->buckets($period, $today);
        $start = array_key_first($buckets);

        $sql = "SELECT DATE(created_at) AS day, transaction_type, COUNT(*) AS n
                FROM transactions
                WHERE created_at >= ? AND transaction_type IN ('INBOUND', 'OUTBOUND')
                GROUP BY DATE(created_at), transaction_type";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([$start . ' 00:00:00']);

        $inbound = array_fill_keys(array_keys($buckets), 0);
        $outbound = $inbound;

        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $key = $this->bucketKey($period, new DateTimeImmutable($row['day']));
            if (!isset($inbound[$key])) continue; // di luar rentang (mis. tanggal masa depan)

            if ($row['transaction_type'] === 'INBOUND') {
                $inbound[$key] += (int) $row['n'];
            } else {
                $outbound[$key] += (int) $row['n'];
            }
        }

        return [
            'period'   => $period,
            'labels'   => array_values($buckets),
            'inbound'  => array_values($inbound),
            'outbound' => array_values($outbound),
        ];
    }

    // Daftar periode: [kunci tanggal-awal => label], urut dari yang paling lama.
    private function buckets(string $period, DateTimeImmutable $today): array {
        $months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        $buckets = [];

        switch ($period) {
            case 'weekly':
                $monday = $today->modify('monday this week');
                for ($i = 11; $i >= 0; $i--) {
                    $d = $monday->modify("-$i week");
                    $buckets[$d->format('Y-m-d')] = $d->format('d/m');
                }
                break;

            case 'monthly':
                $first = $today->modify('first day of this month');
                for ($i = 11; $i >= 0; $i--) {
                    $d = $first->modify("-$i month");
                    $buckets[$d->format('Y-m-d')] = $months[(int) $d->format('n') - 1] . ' ' . $d->format('y');
                }
                break;

            case 'yearly':
                $year = (int) $today->format('Y');
                for ($i = 4; $i >= 0; $i--) {
                    $buckets[($year - $i) . '-01-01'] = (string) ($year - $i);
                }
                break;

            default: // daily
                for ($i = 13; $i >= 0; $i--) {
                    $d = $today->modify("-$i day");
                    $buckets[$d->format('Y-m-d')] = $d->format('d/m');
                }
        }

        return $buckets;
    }

    // Tanggal -> kunci periode tempat tanggal itu masuk (sama dengan kunci di buckets()).
    private function bucketKey(string $period, DateTimeImmutable $day): string {
        switch ($period) {
            case 'weekly':  return $day->modify('monday this week')->format('Y-m-d');
            case 'monthly': return $day->format('Y-m-01');
            case 'yearly':  return $day->format('Y-01-01');
            default:        return $day->format('Y-m-d');
        }
    }
}
