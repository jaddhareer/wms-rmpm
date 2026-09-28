<?php

function sanitize(string $val): string {
    return trim(htmlspecialchars($val, ENT_QUOTES, 'UTF-8'));
}

function generatePalletNumber(PDO $conn, string $itemCode, string $expDate) {
    $query = 'SELECT MAX(pallet_number) FROM stock WHERE item_code = :item_code AND exp_date = :exp_date';
    $stmt = $conn->prepare($query);
    $stmt->execute([
        ':item_code' => $itemCode,
        ':exp_date' => $expDate
    ]);
    $result = $stmt->fetch();

    return $result[0] + 1;
}

function generateTxnId(PDO $conn, string $transactionType):string {
    $typeMap = [
        'INBOUND' => 'IB',
        'OUTBOUND' => 'OB',
        'MUTASI' => 'MT',
        'RETUR' => 'RT'
    ];
    $typecode = $typeMap[$transactionType];
    $prefix = 'RMPM'. $typecode . date('ym');

    $query = 'SELECT COUNT(*) FROM transactions WHERE transaction_code LIKE :prefix';
    $stmt = $conn->prepare($query);
    $stmt->execute([':prefix' => $prefix . '%']);
    $count = (int) $stmt->fetchColumn();
    $sequence = str_pad((string) ($count + 1), 4, '0', STR_PAD_LEFT);
    return $prefix . $sequence;
}