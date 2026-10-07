<?php

// ini model untuk tabel users (login, nanti juga User Management)

class UsersModel {
    private $conn;
    private $table = 'users';

    public function __construct($conn) {
        $this->conn = $conn;
    }

    // Untuk login: satu-satunya method yang ikut mengambil password_hash.
    // Hasilnya jangan pernah dikirim mentah ke frontend.
    // false kalau username tidak ada.
    public function findByUsername(string $username): array|false {
        $query = 'SELECT id, username, full_name, role, password_hash
                  FROM ' . $this->table . '
                  WHERE username = :username';

        $stmt = $this->conn->prepare($query);
        $stmt->execute([':username' => $username]);

        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    // Data user yang aman ditampilkan (tanpa password_hash). false kalau id tidak ada.
    public function findById(int $id): array|false {
        $query = 'SELECT id, username, full_name, role
                  FROM ' . $this->table . '
                  WHERE id = :id';

        $stmt = $this->conn->prepare($query);
        $stmt->execute([':id' => $id]);

        return $stmt->fetch(PDO::FETCH_ASSOC);
    }
}
