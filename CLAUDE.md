# wms-rmpm

WMS internal untuk Raw Material & Packaging Material (RMPM) di gudang LSN.
Stack: OOP PHP (tanpa framework, tanpa Composer) + SPA vanilla JavaScript (ES Modules, tanpa build) + PDO MySQL/MariaDB.
Dijalankan lokal di XAMPP (`C:\xampp`): Apache, PHP 8.2, MariaDB 10.4.

## Cara kerja dengan Hariri (pemilik project)

- Bahasa Indonesia. Jawaban ringkas dan langsung.
- Untuk konsep: jelaskan **apa → kenapa (masalah apa yang diselesaikan) → bagaimana**. Hariri sedang belajar OOP PHP, MVC, dan SPA.
- Kalau diminta kode, berikan kode lengkap yang sudah dites, beserta penjelasan singkat per file.
- **Jangan mengubah keputusan desain atau perilaku yang Hariri buat tanpa bertanya dulu** (contoh: trigger scan 9 karakter di Bin to Bin). Kalau ada masalah, jelaskan dan usulkan, jangan langsung diganti.
- Commit/push hanya kalau diminta.

## Menjalankan

- Database: nama di `config/database.php` (sekarang `wms_rmpm`), user `root` tanpa password.
- `schema.sql` men-DROP dan membuat ulang tabel `stock` & `transactions` (datanya hilang). `users` dan `material_master` hanya dibuat kalau belum ada. **Jangan dijalankan tanpa izin Hariri.**
- Data awal: jalankan `material_master_insert.sql`, dan harus ada minimal satu user di tabel `users` (sekarang `admin`, id 1) untuk login. Sebelum User Management jadi, user baru dibuat manual dengan `password_hash()`.
- Buka lewat `http://localhost/wms-rmpm/`, lalu login.
- File sesi login disimpan di `C:\xampp\tmp\wms-rmpm` (folder sendiri, lihat `startSession()` di `helper.php`).

## Verifikasi (wajib sebelum menyerahkan kode)

Perintah untuk Bash tool (Git Bash). `php` sudah ada di PATH, `mysql` belum.

```bash
php -l controller/Inbound.php                                              # cek sintaks PHP
/c/xampp/mysql/bin/mysql.exe -u root wms_rmpm -e "SELECT ... "             # cek isi DB
curl -s "http://localhost/wms-rmpm/controller/StockController.php?..."     # tes endpoint GET
curl -s -X POST -H "Content-Type: application/json" -d '[...]' \
     http://localhost/wms-rmpm/controller/Inbound.php                       # tes endpoint POST
```

- UI: buka `http://localhost/wms-rmpm/` di browser pane, cek console error, klik alur yang diubah.
- **Data uji**: boleh langsung menulis transaksi uji ke `wms_rmpm` (database dev) lewat endpoint/UI. Sebutkan di laporan transaksi uji apa saja yang dibuat (kode transaksinya).
- Jangan UPDATE/DELETE/TRUNCATE/DROP tabel lewat SQL langsung untuk "membersihkan" data uji. Ledger tetap append-only. Kalau perlu reset, tanya Hariri dulu.

## Struktur & peran (MVC)

```
config/      bootstrap.php (timezone Asia/Jakarta + require semua), database.php, helper.php
model/       HANYA SQL. Stock, Transactions, Material, Dashboard
controller/  HTTP masuk/keluar + orkestrasi beberapa model + DB transaction. Membalas JSON,
             kecuali TransactionPrint.php yang membalas HTML lewat view/
view/        template HTML PHP (hanya untuk halaman cetak), tanpa query
library/     alat bantu yang dipakai controller (XlsxWriter.php = export .xlsx tanpa Composer)
public/      SPA: main.js, pages/*.js (satu file per menu), utilities/*.js, vendor/ (library JS lokal)
index.html   kerangka SPA
```

## Aturan backend

- **Setiap controller wajib login**: panggil `requireLogin()` tepat setelah `require bootstrap.php` (belum login → 401 JSON). Controller tulis memakai `$userId = requireLogin();` sebagai `user_id` di ledger. Halaman HTML (`TransactionPrint.php`) memakai `currentUserId()` dan membalas teks biasa. Pengecualian hanya `UsersController.php` (login/logout/me). Sesi = PHP session, berakhir setelah 8 jam tanpa request (`SESSION_IDLE_SECONDS`).
- Respons JSON lewat `jsonResponse($data, $status)` (memanggil `exit`). Body POST dikirim sebagai JSON → baca dengan `readJsonBody()`, bukan `$_POST`. GET → `$_GET`.
- Transaksi tulis: validasi dulu → `beginTransaction()` → langkah-langkah → `commit()`. Pelanggaran aturan bisnis dilempar sebagai `Exception`. Di `catch`: **`rollBack()` dulu, baru `jsonResponse()`** (karena jsonResponse exit).
- Update stok anti-race: `UPDATE ... WHERE qty_actual >= :qty_check` lalu cek `rowCount() > 0`. Placeholder bernama tidak boleh dipakai dua kali dalam satu query (pakai nama berbeda, mis. `:qty_out` & `:qty_check`). `findPallet()` memakai `SELECT ... FOR UPDATE`.
- `qty_sap` SELALU dihitung di backend = `qty × conversion_factor` milik pallet. Angka dari frontend hanya untuk tampilan.
- LIMIT/OFFSET di-cast ke int lalu ditulis langsung ke SQL. Nilai lain selalu lewat placeholder.
- Escape HTML saat DITAMPILKAN (`escapeHtml()` di JS, `e()` di PHP), bukan saat disimpan. `sanitize()` hanya trim.
- Hati-hati: `?>` di dalam komentar `//` PHP tetap menutup tag PHP.

## Model data

- `stock`: posisi sekarang, **satu baris = satu pallet fisik**. Identitas pallet = `item_code + exp_date + pallet_number` (bin BUKAN identitas, bin hanya lokasi). Pallet yang habis **tidak dihapus**, dibiarkan qty 0. `pallet_number` = MAX+1 per item+exp (aman karena baris tidak pernah dihapus). `conversion_factor` disimpan per pallet: default dari material master, boleh diubah operator saat Inbound.
- `transactions`: ledger **append-only**, setiap baris snapshot lengkap (exp, pallet, qty, qty_sap, bin). Tidak pernah UPDATE/DELETE.
- `transaction_code` = `RMPM` + `IB|OB|MT|RT` + `YYMM` + 4 digit urut. Satu kode per submit (satu dokumen, banyak baris). PK = `id`.
- Isi kolom ledger per jenis:
  - INBOUND: `source` = supplier, `destination_bin`
  - OUTBOUND: `source_bin`, `destination` = PRODUKSI / QUALITY
  - MUTASI (Bin to Bin): `source_bin` → `destination_bin`
  - RETUR: `source` = PRODUKSI / QUALITY, `destination_bin`, `reference_code` = kode OUTBOUND asal. Barang kembali ke nomor pallet asalnya.
- Lokasi TIDAK disimpan, diturunkan dari nama bin (`Dashboard::LOCATIONS`): rak `A-`–`D-` = Gudang 40, `E-`–`F-` = Gudang 50, `FLOOR 40`, `FLOOR 50`. `STAGE` tidak dihitung okupansi.

## Aturan frontend

- Vanilla ES Modules, tanpa framework. State di scope modul, DOM digambar ulang dari state. Event delegation di elemen induk yang stabil.
- Semua data yang masuk `innerHTML` wajib lewat `escapeHtml()`.
- Fetch yang bisa basi (ketik cepat / pindah halaman) memakai penanda `requestId`. Filter saat mengetik memakai `debounce`.
- Router: `public/utilities/router.js`, URL hash dengan parameter (mis. `#retur?code=RMPMOB...`). Halaman memanggil `navigateTo()` dari router, bukan dari main.js (menghindari import melingkar).
- **Path fetch selalu relatif**: `controller/Xxx.php`, JANGAN `/wms-rmpm/controller/...` (supaya tidak terikat nama folder/host).
- **Request ke controller memakai `apiFetch()` dari `utilities/auth.js`, bukan `fetch()` langsung.** Kalau server membalas 401, `apiFetch` membuka popup login ulang lalu mengirim ulang request yang sama (isi form tidak hilang). Hanya `auth.js` sendiri yang memakai `fetch()` (login/logout/me). `auth.js` tidak boleh meng-import `tools.js` (tools.js sudah meng-import auth.js).
- Item code = 9 digit angka → pakai `ITEM_CODE_PATTERN` dari `utilities/materialAutocomplete.js` (bukan `length === 9`). Input item code di Inbound/Outbound/Bin to Bin memakai `materialAutocomplete()` (ketik deskripsi → pilih → input diganti item code). Outbound & Bin to Bin hanya menyarankan material yang ada stoknya.
- Bin to Bin: source bin otomatis dicari saat panjangnya 9 karakter (scan QR rak). Ini disengaja, pallet di floor dicari lewat scan item code.
- Library JS disimpan lokal di `public/vendor/` (Chart.js, signature_pad). Jangan pakai CDN, gudang tidak selalu ada internet.

## Belum dikerjakan

1. **User Management** (Login sudah jadi). Tambahkan aksinya di `controller/UsersController.php` (class, satu method per aksi) dan SQL-nya di `model/UsersModel.php`. Halamannya di `public/pages/users.js` (masih kosong). Menu "User" di `main.js` (`data-page="user"`) masih placeholder dan belum meng-import `users.js`. Role belum dipakai untuk membatasi menu; pembatasan per role dikerjakan di sini. Jangan membuat file baru di tempat lain.
