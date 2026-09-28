<?php

class Stock{
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
    public function setConversionFactor($conversionFactor) {$this->conversionFactor = $conversionFactor;}
    public function setQtySap($qtySap)             {$this->qtySap = $qtySap;}
    public function setRemark($remark)             {$this->remark = $remark;}

    public function stockin(){
        // id (AUTO_INCREMENT) dan updated_at (DEFAULT CURRENT_TIMESTAMP) sengaja tidak
        // disebut di sini -- biarkan database yang isi otomatis, jangan kirim '' ke kolom itu.
        $query = 'INSERT INTO ' . $this->table . '
            (item_code, exp_date, pallet_number, bin, qty_actual, conversion_factor, qty_sap, remark)
            VALUES
            (:item_code, :exp_date, :pallet_number, :bin, :qty_actual, :conversion_factor, :qty_sap, :remark)
            ON DUPLICATE KEY UPDATE
            qty_actual = :qty_actual,
            conversion_factor = :conversion_factor,
            qty_sap = :qty_sap';

        $stmt = $this->conn->prepare($query);

        return $stmt->execute([
            ':item_code' => $this->itemCode,
            ':exp_date' => $this->expDate,
            ':pallet_number' => $this->palletNumber,
            ':bin' => $this->bin,
            ':qty_actual' => $this->qtyActual,
            ':conversion_factor' => $this->conversionFactor,
            ':qty_sap' => $this->qtySap,
            ':remark' => $this->remark
        ]);
    }

    public function stockout(){
        $query = 'UPDATE ' . $this->table . '
            SET qty_actual = qty_actual - :qty_actual,
                qty_sap = qty_sap - :qty_sap
            WHERE item_code = :item_code AND exp_date = :exp_date AND pallet_number = :pallet_number';

        $stmt = $this->conn->prepare($query);

        return $stmt->execute([
            ':item_code' => $this->itemCode,
            ':exp_date' => $this->expDate,
            ':pallet_number' => $this->palletNumber,
            ':qty_actual' => $this->qtyActual,
            ':qty_sap' => $this->qtySap
        ]);
    }

    public function getStockByItemCode($itemCode){
        $query = 'SELECT s.*, t.description FROM ' . $this->table . ' s
                  JOIN material_master t ON s.item_code = t.item_code  
            WHERE s.item_code = :item_code';

        $stmt = $this->conn->prepare($query);
        $stmt->execute([
            ':item_code' => $itemCode
        ]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
}