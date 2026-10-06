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
    // Kolom description diberi alias item_name supaya bentuk datanya sama dengan
    // hasil pencarian per item code di MaterialController.
    public function search(string $keyword, int $limit = 10): array {
        $words = preg_split('/\s+/', trim($keyword), -1, PREG_SPLIT_NO_EMPTY);
        $words = array_slice($words, 0, 5); // batasi jumlah kata, cukup untuk mencari

        if (!$words) {
            return [];
        }

        $conditions = [];
        $params = [];
        foreach ($words as $word) {
            $conditions[] = '(description LIKE ? OR item_code LIKE ?)';
            $params[] = '%' . $word . '%';
            $params[] = '%' . $word . '%';
        }

        $query = 'SELECT item_code, description AS item_name, uom_fisik, uom_sap, conversion_factor
                  FROM ' . $this->table . '
                  WHERE ' . implode(' AND ', $conditions) . '
                  ORDER BY description
                  LIMIT ' . (int) $limit;

        $stmt = $this->conn->prepare($query);
        $stmt->execute($params);

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
}