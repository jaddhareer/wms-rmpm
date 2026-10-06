<?php

// ini model untuk tabel transactions (ledger)

class Transactions {
    private $conn;
    private $table = 'transactions';

    private $transactionCode;
    private $transactionType;
    private $itemCode;
    private $expDate;
    private $palletNumber;
    private $qtyActual;
    private $qtySap;
    private $source;
    private $sourceBin;
    private $destination;
    private $destinationBin;
    private $userId;
    private $remark;

    public function __construct($conn)             {$this->conn = $conn;}
    public function setTransactionCode($v)         {$this->transactionCode = $v;}
    public function setTransactionType($v)         {$this->transactionType = $v;}
    public function setItemCode($v)                {$this->itemCode = $v;}
    public function setExpDate($v)                 {$this->expDate = $v;}
    public function setPalletNumber($v)            {$this->palletNumber = $v;}
    public function setQtyActual($v)               {$this->qtyActual = $v;}
    public function setQtySap($v)                  {$this->qtySap = $v;}
    public function setSource($v)                  {$this->source = $v;}
    public function setSourceBin($v)               {$this->sourceBin = $v;}
    public function setDestination($v)             {$this->destination = $v;}
    public function setDestinationBin($v)          {$this->destinationBin = $v;}
    public function setUserId($v)                  {$this->userId = $v;}
    public function setRemark($v)                  {$this->remark = $v;}

    public function save() {
        // transaction_code jadi PRIMARY KEY (diisi manual dari generateTransactionCode()),
        // created_at punya DEFAULT CURRENT_TIMESTAMP -- sama seperti Stock, tidak disebut di sini.
        $query = 'INSERT INTO ' . $this->table . '
            (transaction_code, transaction_type, item_code, exp_date, pallet_number,
             qty_actual, qty_sap, source, source_bin, destination, destination_bin,
             user_id, remark)
            VALUES
            (:transaction_code, :transaction_type, :item_code, :exp_date, :pallet_number,
             :qty_actual, :qty_sap, :source, :source_bin, :destination, :destination_bin,
             :user_id, :remark)';

        $stmt = $this->conn->prepare($query);

        return $stmt->execute([
            ':transaction_code' => $this->transactionCode,
            ':transaction_type' => $this->transactionType,
            ':item_code'        => $this->itemCode,
            ':exp_date'         => $this->expDate,
            ':pallet_number'    => $this->palletNumber,
            ':qty_actual'       => $this->qtyActual,
            ':qty_sap'          => $this->qtySap,
            ':source'           => $this->source,
            ':source_bin'       => $this->sourceBin,
            ':destination'      => $this->destination,
            ':destination_bin'  => $this->destinationBin,
            ':user_id'          => $this->userId,
            ':remark'           => $this->remark,
        ]);
    }

    // =========================================================
    // BAGIAN BACA (halaman Histori Transaksi)
    // Method di atas menulis SATU baris ledger (pakai setter).
    // Method di bawah membaca BANYAK baris ledger (pakai array $filters).
    // =========================================================

    // Jenis transaksi yang boleh dipakai sebagai filter (sama dengan ENUM di database).
    private const TYPES = ['INBOUND', 'OUTBOUND', 'MUTASI', 'RETUR'];

    // Kolom yang ditampilkan di tabel. Satu baris = satu pallet dalam satu transaksi.
    private const COLUMNS = '
        t.id, t.transaction_code, t.transaction_type,
        t.item_code, m.description, t.exp_date, t.pallet_number,
        t.source, t.source_bin, t.destination, t.destination_bin,
        t.qty_actual, m.uom_fisik, t.qty_sap, m.uom_sap,
        COALESCE(u.full_name, u.username) AS user_name,
        t.remark, t.created_at';

    // JOIN material_master untuk deskripsi & UoM, LEFT JOIN users supaya baris ledger
    // tetap tampil walaupun user-nya suatu saat dihapus.
    private function fromClause(): string {
        return 'FROM ' . $this->table . ' t
                JOIN material_master m ON m.item_code = t.item_code
                LEFT JOIN users u ON u.id = t.user_id';
    }

    // Ambil satu halaman data sesuai filter.
    public function search(array $filters, int $limit, int $offset): array {
        [$where, $params] = $this->buildWhere($filters);

        // $limit dan $offset dipastikan angka, lalu ditulis langsung ke SQL.
        // Kalau lewat execute(), PDO mengirimnya sebagai string ('50') dan MySQL menolak.
        $limit  = max(1, $limit);
        $offset = max(0, $offset);

        // t.id DESC = pemecah seri: pallet dalam satu submit punya created_at yang sama.
        // Tanpa ini urutannya tidak pasti, dan OFFSET bisa menampilkan baris dobel/hilang.
        $sql = 'SELECT ' . self::COLUMNS . ' ' . $this->fromClause() . "
                $where
                ORDER BY t.created_at DESC, t.id DESC
                LIMIT $limit OFFSET $offset";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // Hitung total baris yang cocok dengan filter (untuk jumlah halaman).
    // Memakai buildWhere() yang sama dengan search(), jadi hasilnya pasti konsisten.
    public function countAll(array $filters): int {
        [$where, $params] = $this->buildWhere($filters);

        $stmt = $this->conn->prepare('SELECT COUNT(*) ' . $this->fromClause() . " $where");
        $stmt->execute($params);

        return (int) $stmt->fetchColumn();
    }

    // Semua baris yang cocok dengan filter, tanpa LIMIT (untuk export Excel).
    // Sama seperti search(), hanya tanpa paginasi.
    public function searchAll(array $filters): array {
        [$where, $params] = $this->buildWhere($filters);

        $sql = 'SELECT ' . self::COLUMNS . ' ' . $this->fromClause() . "
                $where
                ORDER BY t.created_at DESC, t.id DESC";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // Semua baris milik satu kode transaksi (untuk popup detail).
    public function findByCode(string $code): array {
        $sql = 'SELECT ' . self::COLUMNS . ' ' . $this->fromClause() . '
                WHERE t.transaction_code = ?
                ORDER BY t.id ASC';

        $stmt = $this->conn->prepare($sql);
        $stmt->execute([$code]);

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // Menyusun WHERE dari filter. Mengembalikan [teks WHERE, array parameter].
    // Hanya filter yang diisi yang ikut. Nilai SELALU lewat placeholder (?),
    // yang digabung ke SQL hanya teks kondisinya.
    private function buildWhere(array $filters): array {
        $conditions = ['1=1']; // supaya implode(' AND ') tetap valid walau tanpa filter
        $params = [];

        // Kode transaksi: cocok sebagian, mis. "IB2609" menemukan semua inbound bulan itu.
        if (($filters['code'] ?? '') !== '') {
            $conditions[] = 't.transaction_code LIKE ?';
            $params[] = '%' . $filters['code'] . '%';
        }

        // Jenis transaksi: bisa lebih dari satu. Hanya nilai yang dikenal yang dipakai.
        $types = array_values(array_intersect(
            array_map('strtoupper', self::splitList($filters['types'] ?? '')),
            self::TYPES
        ));
        if ($types) {
            $placeholders = implode(',', array_fill(0, count($types), '?'));
            $conditions[] = "t.transaction_type IN ($placeholders)";
            array_push($params, ...$types);
        }

        // Description: bisa lebih dari satu, dipisah koma. Tiap kata juga dicocokkan ke item code.
        $descriptions = self::splitList($filters['description'] ?? '');
        if ($descriptions) {
            $parts = [];
            foreach ($descriptions as $d) {
                $parts[] = '(m.description LIKE ? OR t.item_code LIKE ?)';
                $params[] = "%$d%";
                $params[] = "%$d%";
            }
            // Dikurung! Tanpa kurung, OR di sini "membatalkan" filter-filter lain.
            $conditions[] = '(' . implode(' OR ', $parts) . ')';
        }

        // Source: teks (supplier, PRODUKSI) ATAU bin asal. Destination sama polanya.
        if (($filters['source'] ?? '') !== '') {
            $conditions[] = '(t.source LIKE ? OR t.source_bin LIKE ?)';
            $params[] = '%' . $filters['source'] . '%';
            $params[] = '%' . $filters['source'] . '%';
        }
        if (($filters['destination'] ?? '') !== '') {
            $conditions[] = '(t.destination LIKE ? OR t.destination_bin LIKE ?)';
            $params[] = '%' . $filters['destination'] . '%';
            $params[] = '%' . $filters['destination'] . '%';
        }

        // Rentang waktu: tanggal wajib, jam opsional (default awal/akhir hari).
        $from = self::toDateTime($filters['date_from'] ?? '', $filters['time_from'] ?? '', false);
        if ($from !== null) {
            $conditions[] = 't.created_at >= ?';
            $params[] = $from;
        }
        $to = self::toDateTime($filters['date_to'] ?? '', $filters['time_to'] ?? '', true);
        if ($to !== null) {
            $conditions[] = 't.created_at <= ?';
            $params[] = $to;
        }

        return ['WHERE ' . implode(' AND ', $conditions), $params];
    }

    // "a, b,,c " -> ['a', 'b', 'c']
    private static function splitList(string $value): array {
        return array_values(array_filter(
            array_map('trim', explode(',', $value)),
            fn($v) => $v !== ''
        ));
    }

    // Gabungkan tanggal + jam jadi 'Y-m-d H:i:s'. Format yang tidak valid diabaikan (null).
    private static function toDateTime(string $date, string $time, bool $endOfRange): ?string {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            return null;
        }
        if (preg_match('/^\d{2}:\d{2}$/', $time)) {
            return "$date $time:" . ($endOfRange ? '59' : '00');
        }
        return $date . ($endOfRange ? ' 23:59:59' : ' 00:00:00');
    }
}