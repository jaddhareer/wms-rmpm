<?php

class Stock{
    private $conn;
    private $table = 'stock';

    private $itemCode;
    private $expDate;
    private $palletNumber;
    private $bin;
    private $qtyActual;
    private $qtySap;
    private $remark;

    public function __construct($conn)             {$this->conn = $conn;}
    public function setItemCode($itemCode)         {$this->itemCode = $itemCode;}
    public function setExpDate($expDate)           {$this->expDate = $expDate;}
    public function setPalletNumber($palletNumber) {$this->palletNumber = $palletNumber;}
    public function setBin($bin)                   {$this->bin = $bin;}
    public function setQtyActual($qtyActual)       {$this->qtyActual = $qtyActual;}
    public function setQtySap($qtySap)             {$this->qtySap = $qtySap;}
    public function setRemark($remark)             {$this->remark = $remark;}

    public function save(){
        $query = 'INSERT INTO ' . $this->table . " (id, item_code, exp_date, pallet_number, bin, qty_actual, qty_sap, remark, updated_at) VALUES ('', :item_code, :exp_date, :pallet_number, :bin, :qty_actual, :qty_sap, :remark, '')";
        $stmt = $this->conn->prepare($query);
        $stmt->execute([
            ':item_code' => $this->itemCode,
            ':exp_date' => $this->expDate,
            ':pallet_number' => $this->palletNumber,
            ':bin' => $this->bin,
            ':qty_actual' => $this->qtyActual,
            ':qty_sap' => $this->qtySap,
            ':remark' => $this->remark
        ]);
    }
}