<?php

class Database {
    private $host = "localhost";
    private $database = "wms_rmpm";
    private $username = "root";
    private $password = "";
    public $conn;

    public function getConnection() {
        $this->conn = null;

        try {
            $koneksi = 'mysql:host=' . $this->host . ';dbname=' . $this->database . ';charset=utf8mb4';
            $this->conn = new PDO($koneksi, $this->username, $this->password);
            $this->conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        } catch (PDOException $e) {
            // Balas JSON (format sama dengan controller lain) supaya frontend bisa menampilkan
            // result.error. Dulu di sini echo teks biasa lalu return null: res.json() di frontend
            // gagal parse dan controller lanjut jalan dengan $conn = null.
            // jsonResponse() ada di helper.php (dimuat bootstrap.php) dan memanggil exit.
            jsonResponse(['success' => false, 'error' => 'Koneksi database gagal: ' . $e->getMessage()], 500);
        }

        return $this->conn;
    }
}