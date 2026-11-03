<?php

// ini model untuk material master

class Material{
    private $conn;
    private $table = 'material_master';

    private $itemCode;
    private $itemName;
    private $uomFisik;
    private $uomSap;
    private $conversionFactor;

    public function __construct($conn){
        $this->conn = $conn;
    }

    public function setItemCode($itemCode)     {$this->itemCode = $itemCode;}
    private function setItemName($itemName)     {$this->itemName = $itemName;}
    private function setUomFisik($uomFisik)     {$this->uomFisik = $uomFisik;}
    private function setUomSap($uomSap)         {$this->uomSap = $uomSap;}
    private function setConversionFactor($conversionFactor) {$this->conversionFactor = $conversionFactor;}

    public function getItemCode()     {return $this->itemCode;}
    public function getItemName()     {return $this->itemName;}
    public function getUomFisik()     {return $this->uomFisik;}
    public function getUomSap()       {return $this->uomSap;}
    public function getConversionFactor() {return $this->conversionFactor;}

    public function selectMaterial(){
        $query = 'SELECT item_code, description, uom_fisik, uom_sap, conversion_factor
                  FROM ' . $this->table . '
                  WHERE item_code = :item_code';

        $stmt = $this->conn->prepare($query);
        $stmt->bindParam(':item_code', $this->itemCode);
        $stmt->execute();
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if($row){
            $this->setItemCode($row['item_code']);
            $this->setItemName($row['description']);
            $this->setUomFisik($row['uom_fisik']);
            $this->setUomSap($row['uom_sap']);
            $this->setConversionFactor($row['conversion_factor']);
        }

        return $row;
    }

    // Saran untuk autocomplete. Setiap kata yang diketik harus ada di description
    // atau item code, urutan kata bebas: "carton brown" cocok dengan
    // "Carton Box 10Kg 2x5Kg Brug Brown".
    // $inStockOnly = true -> hanya material yang masih punya pallet berisi (Outbound,
    // Bin to Bin): tidak ada gunanya menyarankan barang yang stoknya kosong.
    // Kolom description diberi alias item_name supaya bentuk datanya sama dengan
    // hasil pencarian per item code di MaterialController.
    public function search(string $keyword, bool $inStockOnly = false, int $limit = 10): array {
        [$conditions, $params] = $this->keywordConditions($keyword);

        if (!$conditions) {
            return [];
        }

        if ($inStockOnly) {
            $conditions[] = 'EXISTS (SELECT 1 FROM stock s WHERE s.item_code = m.item_code AND s.qty_actual > 0)';
        }

        $query = 'SELECT m.item_code, m.description AS item_name, m.uom_fisik, m.uom_sap, m.conversion_factor
                  FROM ' . $this->table . ' m
                  WHERE ' . implode(' AND ', $conditions) . '
                  ORDER BY m.description
                  LIMIT ' . (int) $limit;

        $stmt = $this->conn->prepare($query);
        $stmt->execute($params);

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // Setiap kata harus ada di description atau item code (dipakai search() dan searchPage()).
    // Mengembalikan [daftar kondisi, parameter]. Tidak ada kata = tidak ada kondisi.
    private function keywordConditions(string $keyword): array {
        $words = preg_split('/\s+/', trim($keyword), -1, PREG_SPLIT_NO_EMPTY);
        $words = array_slice($words, 0, 5); // batasi jumlah kata, cukup untuk mencari

        $conditions = [];
        $params = [];
        foreach ($words as $word) {
            $conditions[] = '(m.description LIKE ? OR m.item_code LIKE ?)';
            $params[] = '%' . $word . '%';
            $params[] = '%' . $word . '%';
        }

        return [$conditions, $params];
    }

    // =========================================================
    // Menu Material (admin): daftar, tambah, ubah. Material tidak pernah dihapus
    // (item_code dipakai sebagai kunci di stock dan transactions).
    // =========================================================

    // Satu halaman daftar material, urut item code.
    // used = 1 kalau item sudah pernah ditransaksikan -> UoM-nya terkunci (lihat isUsed()).
    public function searchPage(string $keyword, int $limit, int $offset): array {
        [$conditions, $params] = $this->keywordConditions($keyword);
        $where = $conditions ? 'WHERE ' . implode(' AND ', $conditions) : '';

        $limit  = max(1, $limit);
        $offset = max(0, $offset);

        $query = "SELECT m.item_code, m.description, m.uom_fisik, m.uom_sap, m.conversion_factor, m.updated_at,
                         EXISTS (SELECT 1 FROM transactions t WHERE t.item_code = m.item_code) AS used
                  FROM {$this->table} m
                  $where
                  ORDER BY m.item_code
                  LIMIT $limit OFFSET $offset";

        $stmt = $this->conn->prepare($query);
        $stmt->execute($params);

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function countSearch(string $keyword): int {
        [$conditions, $params] = $this->keywordConditions($keyword);
        $where = $conditions ? 'WHERE ' . implode(' AND ', $conditions) : '';

        $stmt = $this->conn->prepare("SELECT COUNT(*) FROM {$this->table} m $where");
        $stmt->execute($params);

        return (int) $stmt->fetchColumn();
    }

    // Semua UoM yang sudah ada (fisik & SAP), untuk saran di form supaya penulisannya seragam.
    public function distinctUoms(): array {
        $stmt = $this->conn->query(
            "SELECT uom_fisik AS uom FROM {$this->table} UNION SELECT uom_sap FROM {$this->table} ORDER BY uom"
        );

        return $stmt->fetchAll(PDO::FETCH_COLUMN);
    }

    // Sudah pernah ditransaksikan? UoM tidak disimpan di stock/ledger (selalu dibaca dari sini),
    // jadi mengubah UoM item yang sudah dipakai membuat qty lama terbaca dengan satuan baru.
    // Cukup cek ledger: setiap baris stock berasal dari transaksi INBOUND.
    public function isUsed(string $itemCode): bool {
        $stmt = $this->conn->prepare('SELECT EXISTS (SELECT 1 FROM transactions WHERE item_code = ?)');
        $stmt->execute([$itemCode]);

        return (bool) $stmt->fetchColumn();
    }

    // Satu material, barisnya dikunci sampai commit (dipakai saat edit).
    public function findForUpdate(string $itemCode) {
        $stmt = $this->conn->prepare("SELECT * FROM {$this->table} WHERE item_code = ? FOR UPDATE");
        $stmt->execute([$itemCode]);

        return $stmt->fetch(PDO::FETCH_ASSOC); // false kalau tidak ada
    }

    // INSERT biasa: item code kembar ditolak database (PRIMARY KEY), ditangkap di controller.
    public function create(string $itemCode, string $description, string $uomFisik, string $uomSap, float $factor): void {
        $stmt = $this->conn->prepare(
            "INSERT INTO {$this->table} (item_code, description, uom_fisik, uom_sap, conversion_factor)
             VALUES (?, ?, ?, ?, ?)"
        );
        $stmt->execute([$itemCode, $description, $uomFisik, $uomSap, $factor]);
    }

    public function update(string $itemCode, string $description, string $uomFisik, string $uomSap, float $factor): void {
        $stmt = $this->conn->prepare(
            "UPDATE {$this->table}
             SET description = ?, uom_fisik = ?, uom_sap = ?, conversion_factor = ?
             WHERE item_code = ?"
        );
        $stmt->execute([$description, $uomFisik, $uomSap, $factor, $itemCode]);
    }
}