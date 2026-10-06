<?php

class Stock {
    private $conn;
    private $table = 'stock';

    private $itemCode;
    private $expDate;
    private $palletNumber;
    private $bin;
    private $qtyActual;
    private $conversionFactor;
    private $qtySap;
    private $remark;

    public function __construct($conn)             {$this->conn = $conn;}
    public function setItemCode($itemCode)         {$this->itemCode = $itemCode;}
    public function setExpDate($expDate)           {$this->expDate = $expDate;}
    public function setPalletNumber($palletNumber) {$this->palletNumber = $palletNumber;}
    public function setBin($bin)                   {$this->bin = $bin;}
    public function setQtyActual($qtyActual)       {$this->qtyActual = $qtyActual;}
    public function setConversionFactor($factor)   {$this->conversionFactor = $factor;}
    public function setQtySap($qtySap)             {$this->qtySap = $qtySap;}
    public function setRemark($remark)             {$this->remark = $remark;}

    // Pallet baru dari Inbound. INSERT biasa: kalau sampai duplikat, itu tanda bug,
    // dan lebih baik gagal keras (lalu rollback) daripada diam-diam menimpa stok lama.
    public function stockin() {
        $query = 'INSERT INTO ' . $this->table . '
            (item_code, exp_date, pallet_number, bin, qty_actual, conversion_factor, qty_sap, remark)
            VALUES
            (:item_code, :exp_date, :pallet_number, :bin, :qty_actual, :conversion_factor, :qty_sap, :remark)';

        $stmt = $this->conn->prepare($query);

        return $stmt->execute([
            ':item_code'         => $this->itemCode,
            ':exp_date'          => $this->expDate,
            ':pallet_number'     => $this->palletNumber,
            ':bin'               => $this->bin,
            ':qty_actual'        => $this->qtyActual,
            ':conversion_factor' => $this->conversionFactor,
            ':qty_sap'           => $this->qtySap,
            ':remark'            => $this->remark,
        ]);
    }

    // Kurangi stok. Return true kalau berhasil, false kalau stok tidak cukup / pallet tidak ada.
    // Syarat qty_actual >= :qty_check membuat "cek" dan "kurangi" jadi SATU langkah.
    // Placeholder dibedakan (:qty_out dan :qty_check) walau nilainya sama, karena
    // PDO tidak selalu mengizinkan satu nama placeholder dipakai dua kali.
    public function stockout(): bool {
        $query = 'UPDATE ' . $this->table . '
            SET qty_actual = qty_actual - :qty_out,
                qty_sap    = qty_sap - :qty_sap
            WHERE item_code = :item_code
              AND exp_date = :exp_date
              AND pallet_number = :pallet_number
              AND qty_actual >= :qty_check';

        $stmt = $this->conn->prepare($query);
        $stmt->execute([
            ':qty_out'       => $this->qtyActual,
            ':qty_sap'       => $this->qtySap,
            ':item_code'     => $this->itemCode,
            ':exp_date'      => $this->expDate,
            ':pallet_number' => $this->palletNumber,
            ':qty_check'     => $this->qtyActual,
        ]);

        return $stmt->rowCount() > 0;
    }

        // Pindahkan pallet ke bin baru (setBin = bin tujuan).
    // $sourceBin = bin asal. Syarat "bin = :source_bin" memastikan pallet memang
    // masih ada di bin asal. Return false kalau tidak ada baris yang berubah.
    public function updateBin($sourceBin) {
        $query = 'UPDATE ' . $this->table . '
            SET bin = :target_bin
            WHERE item_code = :item_code
              AND exp_date = :exp_date
              AND pallet_number = :pallet_number
              AND bin = :source_bin';

        $stmt = $this->conn->prepare($query);
        $stmt->execute([
            ':target_bin'    => $this->bin,
            ':item_code'     => $this->itemCode,
            ':exp_date'      => $this->expDate,
            ':pallet_number' => $this->palletNumber,
            ':source_bin'    => $sourceBin,
        ]);

        return $stmt->rowCount() > 0;
    }

    // Retur: tambah qty kembali ke pallet asal (butuh setItemCode, setExpDate, setPalletNumber,
    // setQtyActual, setQtySap). $newBin diisi kalau pallet sebelumnya kosong (qty 0) dan
    // barang yang kembali ditaruh di lokasi baru; null = bin tidak berubah.
    public function stockReturn(?string $newBin = null): bool {
        $query = 'UPDATE ' . $this->table . '
            SET qty_actual = qty_actual + :qty_in,
                qty_sap    = qty_sap + :qty_sap,
                bin        = COALESCE(:new_bin, bin)
            WHERE item_code = :item_code AND exp_date = :exp_date AND pallet_number = :pallet_number';

        $stmt = $this->conn->prepare($query);
        $stmt->execute([
            ':qty_in'        => $this->qtyActual,
            ':qty_sap'       => $this->qtySap,
            ':new_bin'       => $newBin,
            ':item_code'     => $this->itemCode,
            ':exp_date'      => $this->expDate,
            ':pallet_number' => $this->palletNumber,
        ]);

        return $stmt->rowCount() > 0;
    }

    // Ambil satu pallet (butuh setItemCode, setExpDate, setPalletNumber).
    // FOR UPDATE mengunci baris ini sampai commit/rollback, supaya data yang dibaca
    // (bin, sisa qty) tidak berubah oleh proses lain sebelum kita selesai.
    public function findPallet() {
        $query = 'SELECT * FROM ' . $this->table . '
            WHERE item_code = :item_code AND exp_date = :exp_date AND pallet_number = :pallet_number
            FOR UPDATE';

        $stmt = $this->conn->prepare($query);
        $stmt->execute([
            ':item_code'     => $this->itemCode,
            ':exp_date'      => $this->expDate,
            ':pallet_number' => $this->palletNumber,
        ]);

        return $stmt->fetch(PDO::FETCH_ASSOC); // false kalau tidak ada
    }

    // Semua pallet yang masih ada isinya untuk satu item, urut FEFO
    // (expired paling dekat dulu, lalu nomor pallet). Pallet qty 0 tidak ikut.
    // conversion_factor diambil dari stock (faktor pallet itu sendiri), bukan default master.
    public function getStockByItemCode($itemCode) {
        $query = 'SELECT s.item_code, m.description, s.exp_date, s.pallet_number, s.bin,
                         s.qty_actual, s.conversion_factor, s.qty_sap, s.remark,
                         m.uom_fisik, m.uom_sap
                  FROM ' . $this->table . ' s
                  JOIN material_master m ON s.item_code = m.item_code
                  WHERE s.item_code = :item_code AND s.qty_actual > 0
                  ORDER BY s.exp_date ASC, s.pallet_number ASC';

        $stmt = $this->conn->prepare($query);
        $stmt->execute([':item_code' => $itemCode]);

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function getStockByBin($bin) {
        $query = 'SELECT s.item_code, m.description, s.exp_date, s.pallet_number, s.bin,
                         s.qty_actual, s.conversion_factor, s.qty_sap, s.remark,
                         m.uom_fisik, m.uom_sap
                  FROM ' . $this->table . ' s
                  JOIN material_master m ON s.item_code = m.item_code
                  WHERE s.bin = :bin AND s.qty_actual > 0
                  ORDER BY s.exp_date ASC, s.pallet_number ASC';

        $stmt = $this->conn->prepare($query);
        $stmt->execute([':bin' => $bin]);

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // =========================================================
    // BAGIAN BACA (halaman Stock Overview). Polanya sama dengan Transactions:
    // buildWhere() menyusun filter, method lain tinggal memakainya.
    //
    // Tabel utama berisi RINGKASAN per lot (item_code + exp_date): jumlah pallet,
    // total qty, dan daftar bin. Klik item code -> daftar pallet lot itu.
    // =========================================================

    // Kunci pengelompokan per lot. Dipakai searchLots() DAN countLots(), jadi jumlah
    // halaman selalu cocok dengan isi tabel. Kolom m.* ikut disebut karena satu item_code
    // hanya punya satu baris master (tidak menambah kelompok), dan MySQL mode ketat
    // mewajibkan semua kolom non-agregat ada di GROUP BY.
    private const LOT_GROUP = 's.item_code, s.exp_date, m.description, m.uom_fisik, m.uom_sap';

    // Kolom per pallet (untuk popup detail dan export Excel).
    private const PALLET_COLUMNS = '
        s.item_code, m.description, s.exp_date, s.pallet_number, s.bin,
        s.qty_actual, m.uom_fisik, s.conversion_factor, s.qty_sap, m.uom_sap,
        s.remark, s.updated_at';

    private function readFrom(): string {
        return 'FROM ' . $this->table . ' s
                JOIN material_master m ON m.item_code = s.item_code';
    }

    // Satu halaman ringkasan per lot, urut expired terdekat dulu (FEFO).
    public function searchLots(array $filters, int $limit, int $offset): array {
        [$where, $params] = $this->buildWhere($filters);

        $limit  = max(1, $limit);
        $offset = max(0, $offset);

        $sql = "SELECT s.item_code, m.description, s.exp_date, m.uom_fisik, m.uom_sap,
                       COUNT(*)          AS pallet_count,
                       SUM(s.qty_actual) AS qty_actual,
                       SUM(s.qty_sap)    AS qty_sap,
                       GROUP_CONCAT(DISTINCT s.bin ORDER BY s.bin SEPARATOR ', ')  AS bins,
                       GROUP_CONCAT(DISTINCT NULLIF(s.remark, '') SEPARATOR '; ') AS remarks
                " . $this->readFrom() . "
                $where
                GROUP BY " . self::LOT_GROUP . "
                ORDER BY s.exp_date ASC, s.item_code ASC
                LIMIT $limit OFFSET $offset";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // Jumlah lot (bukan jumlah pallet). Query di dalam kurung membentuk kelompok
    // dengan GROUP BY yang SAMA seperti searchLots(), lalu kelompoknya dihitung.
    public function countLots(array $filters): int {
        [$where, $params] = $this->buildWhere($filters);

        $sql = 'SELECT COUNT(*) FROM (
                    SELECT 1 ' . $this->readFrom() . "
                    $where
                    GROUP BY " . self::LOT_GROUP . '
                ) AS lots';

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);

        return (int) $stmt->fetchColumn();
    }

    // Pallet-pallet satu lot (popup detail). Filter yang sama tetap berlaku,
    // jadi isi popup selalu cocok dengan angka di baris ringkasannya.
    public function findLotPallets(array $filters, string $itemCode, string $expDate): array {
        [$where, $params] = $this->buildWhere($filters);

        $where .= ' AND s.item_code = ? AND s.exp_date = ?';
        $params[] = $itemCode;
        $params[] = $expDate;

        $sql = 'SELECT ' . self::PALLET_COLUMNS . ' ' . $this->readFrom() . "
                $where
                ORDER BY s.pallet_number ASC";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // Semua pallet yang cocok dengan filter, tanpa paginasi (untuk export Excel).
    public function searchPallets(array $filters): array {
        [$where, $params] = $this->buildWhere($filters);

        $sql = 'SELECT ' . self::PALLET_COLUMNS . ' ' . $this->readFrom() . "
                $where
                ORDER BY s.exp_date ASC, s.item_code ASC, s.pallet_number ASC";

        $stmt = $this->conn->prepare($sql);
        $stmt->execute($params);

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    private function buildWhere(array $filters): array {
        // Kondisi awal: pallet yang sudah habis (qty 0) tidak ditampilkan.
        // Sekaligus menggantikan peran '1=1' di Transactions.
        $conditions = ['s.qty_actual > 0'];
        $params = [];

        // Description: bisa banyak, dipisah koma. Tiap kata juga dicocokkan ke item code.
        $descriptions = splitList($filters['description'] ?? '');
        if ($descriptions) {
            $parts = [];
            foreach ($descriptions as $d) {
                $parts[] = '(m.description LIKE ? OR s.item_code LIKE ?)';
                $params[] = "%$d%";
                $params[] = "%$d%";
            }
            $conditions[] = '(' . implode(' OR ', $parts) . ')';
        }

        // Rentang expired. Isi keduanya dengan tanggal sama untuk mencari satu tanggal.
        if (isValidDate($filters['exp_from'] ?? '')) {
            $conditions[] = 's.exp_date >= ?';
            $params[] = $filters['exp_from'];
        }
        if (isValidDate($filters['exp_to'] ?? '')) {
            $conditions[] = 's.exp_date <= ?';
            $params[] = $filters['exp_to'];
        }

        // Bin: cocok sebagian, mis. "FLOOR 40", atau "A-01" untuk semua bin berawalan itu.
        if (($filters['bin'] ?? '') !== '') {
            $conditions[] = 's.bin LIKE ?';
            $params[] = '%' . $filters['bin'] . '%';
        }

        return ['WHERE ' . implode(' AND ', $conditions), $params];
    }
}