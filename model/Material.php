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
        $words = preg_split('/\s+/', trim($keyword), -1, PREG_SPLIT_NO_EMPTY);
        $words = array_slice($words, 0, 5); // batasi jumlah kata, cukup untuk mencari

        if (!$words) {
            return [];
        }

        $conditions = [];
        $params = [];
        foreach ($words as $word) {
            $conditions[] = '(m.description LIKE ? OR m.item_code LIKE ?)';
            $params[] = '%' . $word . '%';
            $params[] = '%' . $word . '%';
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
}