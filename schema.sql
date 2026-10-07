-- =========================================================
-- WMS-RMPM — Skema
-- PERHATIAN: tabel stock dan transactions di-DROP lalu dibuat ulang (data ujinya hilang).
-- Tabel users dan material_master TIDAK disentuh kalau sudah ada, jadi isinya aman.
--
-- Prinsip:
--   1. Ledger (transactions) = snapshot berdiri sendiri, append-only (tidak pernah UPDATE/DELETE).
--   2. Update stok pakai kondisi qty di WHERE, bukan cek-lalu-update terpisah.
--   3. Identitas pallet = item_code + exp_date + pallet_number. Bin hanya lokasi, BUKAN identitas.
--   4. Pallet yang qty-nya habis TIDAK dihapus, dibiarkan dengan qty 0.
--   5. conversion_factor disimpan per pallet: default dari material_master, tapi boleh berbeda.
-- =========================================================

DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS stock;

-- User tidak pernah dihapus (transactions.user_id menunjuk ke sini), cukup dinonaktifkan.
-- Database lama yang tabel users-nya dibuat sebelum kolom is_active ada:
--   ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER role;
CREATE TABLE IF NOT EXISTS users (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50)  NOT NULL UNIQUE,
    full_name     VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(30)  NOT NULL,          -- admin | operator (hak akses: ROLE_PAGES di config/helper.php)
    is_active     TINYINT(1)   NOT NULL DEFAULT 1, -- 0 = nonaktif: tidak bisa login, sesinya langsung putus
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS material_master (
    item_code          VARCHAR(20)   NOT NULL PRIMARY KEY,
    description        VARCHAR(150)  NOT NULL,
    uom_fisik          VARCHAR(10)   NOT NULL,
    uom_sap            VARCHAR(10)   NOT NULL,
    conversion_factor  DECIMAL(12,4) NOT NULL, -- qty_sap per 1 unit qty_fisik, mis. 1 ROLL = 35.5000 KG
    created_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Posisi stok saat ini. Satu baris = satu pallet fisik (termasuk yang sudah habis, qty 0).
CREATE TABLE stock (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    item_code     VARCHAR(20)   NOT NULL,
    exp_date      DATE          NOT NULL,
    pallet_number INT UNSIGNED  NOT NULL,
    bin           VARCHAR(20)   NOT NULL,
    qty_actual    DECIMAL(14,3) NOT NULL,
    conversion_factor DECIMAL(12,4) NOT NULL, -- faktor pallet ini (bisa beda dari default material master)
    qty_sap       DECIMAL(14,3) NOT NULL,
    remark        VARCHAR(255)  NULL,
    updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Bin sengaja TIDAK ikut: satu pallet hanya boleh ada di satu tempat.
    UNIQUE KEY uq_stock_pallet (item_code, exp_date, pallet_number),
    INDEX idx_stock_bin (bin),

    -- Jaring pengaman terakhir: database menolak stok minus walau ada bug di kode.
    CONSTRAINT chk_stock_qty CHECK (qty_actual >= 0),
    CONSTRAINT fk_stock_item FOREIGN KEY (item_code) REFERENCES material_master(item_code)
) ENGINE=InnoDB;

-- Ledger. Append-only.
-- Satu transaction_code = satu dokumen (satu kali submit), boleh berisi banyak baris/pallet.
-- Karena itu transaction_code bukan PRIMARY KEY; identitas tiap baris adalah id.
--
-- Pemetaan kolom source/destination per transaction_type:
--   INBOUND  -> source = supplier,                 destination_bin = bin taruh
--   OUTBOUND -> source_bin = bin asal,             destination = 'PRODUKSI'/'QUALITY'
--   MUTASI   -> source_bin = bin asal,             destination_bin = bin tujuan
--   RETUR    -> source = 'PRODUKSI'/'QUALITY',     destination_bin = bin taruh balik,
--               reference_code = kode OUTBOUND asal
CREATE TABLE transactions (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    transaction_code  VARCHAR(20)   NOT NULL, -- mis. RMPMIB26090001
    transaction_type  ENUM('INBOUND','OUTBOUND','MUTASI','RETUR') NOT NULL,
    reference_code    VARCHAR(20)   NULL, -- RETUR: kode OUTBOUND asal

    item_code     VARCHAR(20)   NOT NULL,
    exp_date      DATE          NOT NULL,
    pallet_number INT UNSIGNED  NOT NULL,

    qty_actual    DECIMAL(14,3) NOT NULL,
    qty_sap       DECIMAL(14,3) NOT NULL,

    source            VARCHAR(100) NULL,
    source_bin        VARCHAR(20)  NULL,
    destination       VARCHAR(100) NULL,
    destination_bin   VARCHAR(20)  NULL,

    user_id     INT UNSIGNED NOT NULL,
    remark      VARCHAR(255) NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_trx_item FOREIGN KEY (item_code) REFERENCES material_master(item_code),
    CONSTRAINT fk_trx_user FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_trx_code (transaction_code),
    INDEX idx_trx_reference (reference_code),
    INDEX idx_trx_item_exp (item_code, exp_date),
    INDEX idx_trx_created (created_at)
) ENGINE=InnoDB;