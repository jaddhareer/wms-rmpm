<?php

class Database {
    private $host = "localhost";
    private $database = "wms-rmpm";
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
            echo "Koneksi Gagal: " . $e->getMessage();
        }

        return $this->conn;
    }
}