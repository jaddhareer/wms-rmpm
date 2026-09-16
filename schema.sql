-- =========================================================
-- WMS-RMPM — Skema awal
-- Prinsip yang dipegang di skema ini:
--   1. Ledger (transactions) = snapshot berdiri sendiri, tidak join ke tabel lain untuk data historis.
--   2. Update stok pakai kondisi qty di WHERE, bukan cek-lalu-update terpisah (cegah race condition).
--   3. pallet_number melekat ke fisik pallet, bukan ke posisi -> tidak masuk unique key bareng bin,
--      karena bin akan berubah tiap kali pallet dipindah (bin-to-bin), tapi identitas pallet-nya tidak.
-- =========================================================

CREATE TABLE users (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL UNIQUE,
    full_name     VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(30)  NOT NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE material_master (
    item_code          VARCHAR(20)   NOT NULL PRIMARY KEY,
    description        VARCHAR(150)  NOT NULL,
    uom_fisik          VARCHAR(10)   NOT NULL,
    uom_sap            VARCHAR(10)   NOT NULL,
    conversion_factor  DECIMAL(12,4) NOT NULL, -- qty_sap per 1 unit qty_fisik, mis. 1 ROLL = 35.5000 KG
    created_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Posisi stok saat ini. Satu baris = satu pallet fisik di satu lokasi.
CREATE TABLE stock (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    item_code     VARCHAR(20)   NOT NULL,
    exp_date      DATE          NOT NULL,
    pallet_number INT UNSIGNED  NOT NULL, -- identitas fisik pallet, unik dalam lingkup item_code+exp_date
    bin           VARCHAR(20)   NOT NULL, -- input bebas via scan QR, contoh "A1", "F3"
    qty_actual    DECIMAL(14,3) NOT NULL,
    qty_sap       DECIMAL(14,3) NOT NULL,
    remark        VARCHAR(255)  NULL,
    updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Identitas unik satu baris: pallet ini tetap "pallet yang sama" walau bin berubah,
    -- jadi bin sengaja TIDAK ikut di sini (lihat catatan di kepala file).
    UNIQUE KEY uq_stock_pallet (item_code, exp_date, pallet_number),

    CONSTRAINT fk_stock_item FOREIGN KEY (item_code) REFERENCES material_master(item_code)
) ENGINE=InnoDB;

-- Ledger. Immutable: hanya INSERT, tidak pernah UPDATE/DELETE baris yang sudah ada.
CREATE TABLE transactions (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    transaction_code  VARCHAR(30)   NOT NULL UNIQUE, -- ID Transaksi yang tampil di UI, mis. TRX-20260916-0001
    transaction_type  ENUM('INBOUND','OUTBOUND','MUTASI') NOT NULL,

    item_code     VARCHAR(20)   NOT NULL,
    exp_date      DATE          NOT NULL,
    pallet_number INT UNSIGNED  NOT NULL,

    qty_actual    DECIMAL(14,3) NOT NULL,
    qty_sap       DECIMAL(14,3) NOT NULL, -- hasil hitung backend saat itu, dibekukan selamanya

    source            VARCHAR(100) NULL, -- nama supplier (INBOUND) / NULL untuk tipe lain
    source_bin        VARCHAR(20)  NULL, -- bin asal (OUTBOUND, MUTASI)
    destination       VARCHAR(100) NULL, -- 'produksi' / 'quality' (OUTBOUND) / NULL untuk tipe lain
    destination_bin   VARCHAR(20)  NULL, -- bin tujuan (INBOUND, MUTASI)

    user_id     INT UNSIGNED NOT NULL,
    remark      VARCHAR(255) NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_trx_item FOREIGN KEY (item_code) REFERENCES material_master(item_code),
    CONSTRAINT fk_trx_user FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_trx_item_exp (item_code, exp_date),
    INDEX idx_trx_created (created_at)
) ENGINE=InnoDB;
