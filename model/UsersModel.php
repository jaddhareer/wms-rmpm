<?php

// ini model untuk tabel users (login & User Management)
//
// User tidak pernah di-DELETE: transactions.user_id menunjuk ke tabel ini (foreign key),
// jadi user yang sudah keluar cukup dinonaktifkan (is_active = 0).

class UsersModel {
    private $conn;
    private $table = 'users';

    // Kolom yang aman dikirim ke browser. password_hash TIDAK termasuk.
    private const COLUMNS = 'id, username, full_name, role, is_active, created_at';

    public function __construct($conn) {
        $this->conn = $conn;
    }

    // Untuk login: ikut mengambil password_hash. Hasilnya jangan pernah dikirim mentah
    // ke frontend. false kalau username tidak ada.
    public function findByUsername(string $username): array|false {
        $query = 'SELECT ' . self::COLUMNS . ', password_hash
                  FROM ' . $this->table . '
                  WHERE username = :username';

        $stmt = $this->conn->prepare($query);
        $stmt->execute([':username' => $username]);

        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    // false kalau id tidak ada.
    public function findById(int $id): array|false {
        $query = 'SELECT ' . self::COLUMNS . '
                  FROM ' . $this->table . '
                  WHERE id = :id';

        $stmt = $this->conn->prepare($query);
        $stmt->execute([':id' => $id]);

        return $stmt->fetch(PDO::FETCH_ASSOC);
    }

    // Untuk ganti password sendiri (cek password lama). false kalau id tidak ada.
    public function findPasswordHash(int $id): string|false {
        $stmt = $this->conn->prepare('SELECT password_hash FROM ' . $this->table . ' WHERE id = :id');
        $stmt->execute([':id' => $id]);

        return $stmt->fetchColumn();
    }

    // Semua user: yang aktif dulu, lalu urut username.
    public function findAll(): array {
        $query = 'SELECT ' . self::COLUMNS . '
                  FROM ' . $this->table . '
                  ORDER BY is_active DESC, username';

        return $this->conn->query($query)->fetchAll(PDO::FETCH_ASSOC);
    }

    // Mengembalikan id user baru.
    // Username kembar ditolak oleh UNIQUE index -> PDOException kode 1062 (ditangani controller).
    public function create(string $username, string $fullName, string $role, string $passwordHash): int {
        $query = 'INSERT INTO ' . $this->table . ' (username, full_name, role, password_hash)
                  VALUES (:username, :full_name, :role, :password_hash)';

        $stmt = $this->conn->prepare($query);
        $stmt->execute([
            ':username'      => $username,
            ':full_name'     => $fullName,
            ':role'          => $role,
            ':password_hash' => $passwordHash,
        ]);

        return (int) $this->conn->lastInsertId();
    }

    // Username sengaja tidak bisa diubah, hanya nama lengkap & role.
    public function update(int $id, string $fullName, string $role): void {
        $query = 'UPDATE ' . $this->table . '
                  SET full_name = :full_name, role = :role
                  WHERE id = :id';

        $stmt = $this->conn->prepare($query);
        $stmt->execute([':full_name' => $fullName, ':role' => $role, ':id' => $id]);
    }

    public function setActive(int $id, bool $active): void {
        $stmt = $this->conn->prepare('UPDATE ' . $this->table . ' SET is_active = :active WHERE id = :id');
        $stmt->execute([':active' => $active ? 1 : 0, ':id' => $id]);
    }

    public function setPasswordHash(int $id, string $passwordHash): void {
        $stmt = $this->conn->prepare('UPDATE ' . $this->table . ' SET password_hash = :hash WHERE id = :id');
        $stmt->execute([':hash' => $passwordHash, ':id' => $id]);
    }

    // Jumlah admin aktif selain user $exceptId. Dipakai sebelum menurunkan role / menonaktifkan
    // seorang admin, supaya selalu tersisa minimal satu admin.
    // FOR UPDATE (wajib di dalam beginTransaction): baris admin dikunci sampai commit, jadi
    // dua admin yang saling menurunkan role di detik yang sama tidak bisa lolos bersamaan.
    public function countActiveAdminsExcept(int $exceptId): int {
        $query = "SELECT COUNT(*) FROM " . $this->table . "
                  WHERE role = 'admin' AND is_active = 1 AND id <> :id
                  FOR UPDATE";

        $stmt = $this->conn->prepare($query);
        $stmt->execute([':id' => $exceptId]);

        return (int) $stmt->fetchColumn();
    }
}
