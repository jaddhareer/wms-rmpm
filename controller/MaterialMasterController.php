<?php

// Menu Material (khusus role yang punya menu 'material', sekarang admin): daftar, tambah,
// dan ubah material master.
//
//   GET  ?action=list&q=kata&page=2  -> satu halaman material + daftar UoM yang sudah ada
//   POST ?action=create              { item_code, description, uom_fisik, uom_sap, conversion_factor }
//   POST ?action=update              { item_code, description, uom_fisik, uom_sap, conversion_factor }
//
// Aturan:
//   - item_code 9 digit angka, tidak bisa diubah setelah dibuat (kunci di stock & ledger).
//     Material tidak pernah dihapus.
//   - UoM tidak bisa diubah kalau item sudah pernah ditransaksikan: UoM tidak disimpan di
//     stock/ledger, jadi qty lama akan terbaca dengan satuan baru (250.000 G jadi 250.000 KG).
//   - conversion_factor baru hanya jadi default Inbound berikutnya. Pallet yang sudah ada
//     memakai faktornya sendiri (stock.conversion_factor), jadi stoknya tidak berubah.
//
// Pencarian material untuk autocomplete (dipakai semua menu) tetap di MaterialController.php.
// Bentuknya class seperti UsersController: satu method per aksi, dipilih lewat tabel $routes.

header('Content-Type: application/json');

require_once dirname(__DIR__) . '/config/bootstrap.php';

// Semua aksi di sini hanya untuk menu 'material'. Belum login -> 401, role lain -> 403.
requireLogin('material');

class MaterialMasterController {
    private const PER_PAGE = 20;

    private $conn;
    private $material;

    public function __construct(PDO $conn) {
        $this->conn     = $conn;
        $this->material = new Material($conn);
    }

    public function listMaterials(): void {
        $keyword = sanitize($_GET['q'] ?? '');

        $total = $this->material->countSearch($keyword);
        $totalPages = max(1, (int) ceil($total / self::PER_PAGE));
        $page = min(max(1, (int) ($_GET['page'] ?? 1)), $totalPages);

        $rows = $this->material->searchPage($keyword, self::PER_PAGE, ($page - 1) * self::PER_PAGE);

        jsonResponse([
            'success'    => true,
            'data'       => array_map(fn($r) => ['used' => (bool) $r['used']] + $r, $rows),
            'uoms'       => $this->material->distinctUoms(),
            'pagination' => [
                'page'        => $page,
                'per_page'    => self::PER_PAGE,
                'total'       => $total,
                'total_pages' => $totalPages,
            ],
        ]);
    }

    public function create(): void {
        $form = $this->readForm();

        try {
            $this->material->create($form['item_code'], $form['description'], $form['uom_fisik'], $form['uom_sap'], $form['factor']);
        } catch (PDOException $e) {
            // 1062 = PRIMARY KEY kembar. Dicek oleh database, bukan dengan SELECT dulu,
            // supaya dua admin yang menambah item code sama bersamaan tetap ditolak salah satunya.
            if (($e->errorInfo[1] ?? null) === 1062) {
                throw new Exception("Item code {$form['item_code']} sudah ada di material master");
            }
            throw $e;
        }

        jsonResponse(['success' => true]);
    }

    public function update(): void {
        $form = $this->readForm();

        $this->conn->beginTransaction();

        // FOR UPDATE: Inbound yang memakai item ini di saat yang sama menunggu sampai commit
        // (cek foreign key ke material_master), jadi isUsed() di bawah tidak ketinggalan.
        $current = $this->material->findForUpdate($form['item_code']);
        if (!$current) {
            throw new Exception("Item code {$form['item_code']} tidak ada di material master");
        }

        $uomChanged = $form['uom_fisik'] !== $current['uom_fisik'] || $form['uom_sap'] !== $current['uom_sap'];
        if ($uomChanged && $this->material->isUsed($form['item_code'])) {
            throw new Exception('UoM tidak bisa diubah karena item ini sudah punya transaksi (qty lama akan terbaca dengan satuan baru)');
        }

        $this->material->update($form['item_code'], $form['description'], $form['uom_fisik'], $form['uom_sap'], $form['factor']);

        $this->conn->commit();

        jsonResponse(['success' => true]);
    }

    // Isi form dari body JSON, sudah dicek. Batas panjang = ukuran kolom di schema.sql.
    private function readForm(): array {
        $data = readJsonBody();

        $form = [
            'item_code'   => sanitize($data['item_code'] ?? ''),
            'description' => sanitize($data['description'] ?? ''),
            'uom_fisik'   => sanitize($data['uom_fisik'] ?? ''),
            'uom_sap'     => sanitize($data['uom_sap'] ?? ''),
            // DECIMAL(12,4): 4 desimal, maksimal 99.999.999,9999.
            'factor'      => round((float) ($data['conversion_factor'] ?? 0), 4),
        ];

        if (!preg_match('/^\d{9}$/', $form['item_code'])) {
            throw new Exception('Item code harus 9 digit angka');
        }
        if ($form['description'] === '' || mb_strlen($form['description']) > 150) {
            throw new Exception('Description wajib diisi (maksimal 150 karakter)');
        }
        foreach (['uom_fisik' => 'UoM', 'uom_sap' => 'UoM SAP'] as $key => $label) {
            if ($form[$key] === '' || mb_strlen($form[$key]) > 10) {
                throw new Exception("$label wajib diisi (maksimal 10 karakter)");
            }
        }
        if ($form['factor'] <= 0 || $form['factor'] >= 100000000) {
            throw new Exception('Conversion factor harus lebih dari 0 (maksimal 4 angka di belakang koma)');
        }

        return $form;
    }
}

$db = new Database();
$conn = $db->getConnection();
$controller = new MaterialMasterController($conn);

// Tabel rute: method HTTP + ?action= -> nama method di class.
$routes = [
    'GET'  => ['list' => 'listMaterials'],
    'POST' => ['create' => 'create', 'update' => 'update'],
];

$handler = $routes[$_SERVER['REQUEST_METHOD']][sanitize($_GET['action'] ?? '')] ?? null;

if ($handler === null) {
    jsonResponse(['success' => false, 'error' => 'Aksi tidak dikenal'], 404);
}

// Pelanggaran aturan dilempar sebagai Exception: rollBack dulu, baru jsonResponse (exit).
try {
    $controller->$handler();
} catch (Exception $e) {
    if ($conn->inTransaction()) {
        $conn->rollBack();
    }
    jsonResponse(['success' => false, 'error' => $e->getMessage()], 400);
}
