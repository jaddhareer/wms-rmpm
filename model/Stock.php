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
}