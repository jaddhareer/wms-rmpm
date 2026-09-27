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
}