# wms-rmpm

WMS internal untuk Raw Material & Packaging Material (RMPM) di gudang LSN.
Stack: OOP PHP (tanpa framework, tanpa Composer) + SPA vanilla JavaScript (ES Modules, tanpa build) + PDO MySQL/MariaDB.
Dijalankan lokal di XAMPP (`C:\xampp`): Apache, PHP 8.5, MariaDB 10.4. PHP 8.5 dipasang manual: `C:\xampp\php\php.ini` dibuat dari `php.ini-development` (perubahannya dicatat di kepala file), dan DLL OpenSSL/libssh2/nghttp2 di `apache\bin` disamakan dengan versi PHP.

## Cara kerja dengan Hariri (pemilik project)

- Bahasa Indonesia. Jawaban ringkas dan langsung.
- Untuk konsep: jelaskan **apa → kenapa (masalah apa yang diselesaikan) → bagaimana**. Hariri sedang belajar OOP PHP, MVC, dan SPA.
- Kalau diminta kode, berikan kode lengkap yang sudah dites, beserta penjelasan singkat per file.
- **Jangan mengubah keputusan desain atau perilaku yang Hariri buat tanpa bertanya dulu** (contoh: trigger scan 9 karakter di Bin to Bin). Kalau ada masalah, jelaskan dan usulkan, jangan langsung diganti.
- Commit/push hanya kalau diminta.

## Menjalankan

- Database: nama di `config/database.php` (sekarang `wms_rmpm`), user `root` tanpa password.
- `schema.sql` men-DROP dan membuat ulang tabel `stock` & `transactions` (datanya hilang). `users` dan `material_master` hanya dibuat kalau belum ada. **Jangan dijalankan tanpa izin Hariri.**
- Data awal: jalankan `material_master_insert.sql`, dan harus ada minimal satu user admin aktif di tabel `users` (sekarang `admin`, id 1). User lain dibuat lewat menu User.
- User uji yang sudah ada (nonaktif): `uji_operator` (id 3), `uji_ui` (id 4). Untuk menguji role operator, aktifkan lagi lewat menu User lalu reset password-nya.
- Buka lewat `http://localhost/wms-rmpm/`, lalu login.
- File sesi login disimpan di `C:\xampp\tmp\wms-rmpm` (folder sendiri, lihat `sessionDir()` di `helper.php`). Di hosting cPanel folder sesi bawaan milik root, jadi otomatis pindah ke `<temp sistem>/wms-rmpm`.

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
model/       HANYA SQL. Stock, Transactions, Material, Dashboard, UsersModel
controller/  HTTP masuk/keluar + orkestrasi beberapa model + DB transaction. Membalas JSON,
             kecuali TransactionPrint.php yang membalas HTML lewat view/
view/        template HTML PHP (hanya untuk halaman cetak), tanpa query
library/     alat bantu yang dipakai controller (XlsxWriter.php = export .xlsx tanpa Composer)
public/      SPA: main.js, style.css, pages/*.js (satu file per menu), utilities/*.js, vendor/ (library JS lokal)
index.html   kerangka SPA
```

## Aturan backend

- **Setiap controller wajib login + hak akses**: panggil `requireLogin('nama-menu')` tepat setelah `require bootstrap.php`. Belum login / user nonaktif → 401, role tanpa menu itu → 403. Nama menu = `data-page` di navbar = isi `ROLE_PAGES` (`config/helper.php`). Controller pencarian yang dipakai beberapa menu (Material, Stock) cukup `requireLogin()`. Controller tulis memakai `$userId = requireLogin('inbound');` sebagai `user_id` di ledger. Halaman HTML (`TransactionPrint.php`) memakai `currentUser()` + `canAccess()` dan membalas teks biasa.
- Role & hak akses: `ROLE_PAGES` di `helper.php` (sekarang `admin` = semua menu + Material + User, `operator` = semua kecuali Material & User). Menambah role = menambah satu baris di situ. User dibaca ulang dari database setiap request (`currentUser()`), jadi perubahan role/nonaktif langsung berlaku.
- Sesi = PHP session, berakhir setelah 8 jam tanpa request (`SESSION_IDLE_SECONDS`). `startSession()` aman dipanggil lagi setelah `session_write_close()`.
- **401 hanya untuk "belum login / sesi habis"**, karena `apiFetch()` di browser menganggap 401 sebagai sesi habis dan membuka popup login ulang. Kesalahan lain (password lama salah, validasi) → 400.
- Respons JSON lewat `jsonResponse($data, $status)` (memanggil `exit`). Body POST dikirim sebagai JSON → baca dengan `readJsonBody()`, bukan `$_POST`. GET → `$_GET`.
- Transaksi tulis: validasi dulu → `beginTransaction()` → langkah-langkah → `commit()`. Pelanggaran aturan bisnis dilempar sebagai `Exception`. Di `catch`: **`rollBack()` dulu, baru `jsonResponse()`** (karena jsonResponse exit).
- Update stok anti-race: `UPDATE ... WHERE qty_actual >= :qty_check` lalu cek `rowCount() > 0`. Placeholder bernama tidak boleh dipakai dua kali dalam satu query (pakai nama berbeda, mis. `:qty_out` & `:qty_check`). `findPallet()` memakai `SELECT ... FOR UPDATE`.
- `qty_sap` SELALU dihitung di backend lewat `calculateQtySap()` (helper.php) = `qty × conversion_factor` milik pallet, dibulatkan 4 desimal (kolom DECIMAL(15,4)). Angka dari frontend hanya untuk tampilan. Pengecualian: (1) Retur unit tidak utuh (`input_unit: 'sap'`, satu item = satu unit yang ditimbang, mis. ROLL yang tinggal 1,2 KG): qty fisik = 1, qty SAP = angka timbang operator; pallet sisanya memakai faktor = rata-rata berat per unit (lihat RETUR). (2) Ambil semua sisa (Retur semua sisa, Outbound pallet habis): qty SAP = sisa qty SAP persis, supaya tidak ada selisih pembulatan. Tampilan qty SAP selalu 4 desimal: `formatQtySap()` (tools.js / helper.php), Excel: `setFourDecimalColumns()`.
- LIMIT/OFFSET di-cast ke int lalu ditulis langsung ke SQL. Nilai lain selalu lewat placeholder.
- Escape HTML saat DITAMPILKAN (`escapeHtml()` di JS, `e()` di PHP), bukan saat disimpan. `sanitize()` hanya trim.
- Hati-hati: `?>` di dalam komentar `//` PHP tetap menutup tag PHP.

## Model data

- `stock`: posisi sekarang, **satu baris = satu pallet fisik**. Identitas pallet = `item_code + exp_date + pallet_number` (bin BUKAN identitas, bin hanya lokasi). Pallet yang habis **tidak dihapus**, dibiarkan qty 0. `pallet_number` = MAX+1 per item+exp (aman karena baris tidak pernah dihapus). `conversion_factor` disimpan per pallet: default dari material master, boleh diubah operator saat Inbound. `supplier` diisi saat Inbound (= `source` di ledger INBOUND), tidak pernah berubah; tampil di popup detail Stock Overview, bisa difilter, ikut di export. `remark` diisi saat Inbound, bisa diganti lewat tombol Remark per pallet di popup detail Stock Overview (`StockRemark.php`, mis. stok di-reject QC; tercatat di ledger, lihat MUTASI). Remark tampil di popup pilih pallet Outbound / Bin to Bin + toast info saat dipilih, tidak memblokir.
- `material_master`: diubah lewat menu Material (admin, `MaterialMasterController.php`; pencarian autocomplete tetap di `MaterialController.php`). Item code 9 digit, tidak bisa diubah, material tidak pernah dihapus. **UoM terkunci kalau item sudah punya transaksi** (UoM tidak disimpan di stock/ledger, jadi qty lama akan terbaca dengan satuan baru). Conversion factor baru hanya jadi default Inbound berikutnya; pallet yang sudah ada memakai faktornya sendiri.
- `transactions`: ledger **append-only**, setiap baris snapshot lengkap (exp, pallet, qty, qty_sap, bin). Tidak pernah UPDATE/DELETE. Layar Histori menggabung asal/tujuan jadi From/To; export Excel menulis kolom ledger apa adanya (Reference Code, Source, Source Bin, Destination, Destination Bin, Pallet Tujuan).
- `transaction_code` = `RMPM` + `IB|OB|MT|RT` + `YYMM` + 4 digit urut. Satu kode per submit (satu dokumen, banyak baris). PK = `id`.
- Isi kolom ledger per jenis:
  - INBOUND: `source` = supplier, `destination_bin`
  - OUTBOUND: `source_bin`, `destination` = PRODUKSI / QUALITY / OTHER (OTHER = alasan lain, mis. rusak; remark wajib, dicek di frontend & Outbound.php)
  - MUTASI (Bin to Bin): `source_bin` → `destination_bin`. `destination_pallet` NULL = pallet utuh pindah bin. Diisi = gabung pallet: `qty_actual` dari `pallet_number` ditumpuk ke pallet itu (item + exp sama, sudah ada di bin tujuan, supplier & faktor konversi harus sama), pallet asal tetap di bin-nya (habis = qty 0). Dipakai saat gudang kehabisan pallet. Pindah sebagian tanpa pallet tujuan ditolak (satu pallet tidak bisa di dua bin). Replay ledger di `Dashboard::occupancyTrend()` ikut membaca kolom ini (juga untuk RETUR unit tidak utuh → pallet sisa). Remark stok manual juga MUTASI: `source_bin` = `destination_bin` = bin sekarang, qty = isi pallet saat itu (snapshot, stok tidak berubah), remark = "Remark stok: ..." / "Remark stok dihapus".
  - RETUR: `source` = tujuan OUTBOUND asal (PRODUKSI / QUALITY / OTHER), `destination_bin`, `reference_code` = kode OUTBOUND asal. Unit utuh kembali ke nomor pallet asalnya. Form per pallet: Qty Retur Utuh (UoM fisik, qty SAP dihitung otomatis) + daftar unit Tidak Utuh (mis. 5 ROLL utuh + 3 ROLL kecil): tiap unit ditimbang dan ditambahkan satu per satu dalam UoM SAP, berat harus < 1 unit (faktor pallet asal). **Unit tidak utuh dihitung 1 unit fisik dengan beratnya sendiri dan TIDAK masuk pallet asal** (faktor disimpan per pallet; kalau masuk, outbound 1 ROLL kecil terhitung 35,5 KG). Keputusan Hariri: semua unit tidak utuh dari satu pallet asal di satu submit masuk SATU **pallet sisa** baru (`generatePalletNumber`, item & exp sama, bin & supplier sama dengan pallet asal): qty = jumlah unit, qty SAP = total berat persis, faktor = rata-rata berat per unit, remark stok `[TIDAK UTUH] Retur RMPMRT... dari pallet N`. Ledger tetap satu baris per unit: `pallet_number` = pallet asal (batas retur dokumen outbound tetap terhitung), `destination_pallet` = pallet sisa, qty 1, qty SAP = beratnya. Satu Add = satu baris utuh + satu baris per unit tidak utuh, semuanya satu kode RETUR; pallet yang sama boleh di-Add lagi selama ada sisa. **Remark baris tidak utuh diawali `[TIDAK UTUH]`** (`RETUR_PARTIAL_MARK`, dipakai Hariri untuk laporan: jumlah baris = jumlah unit, qty SAP = beratnya; keputusan Hariri: penanda di remark, bukan kolom baru). Batas retur dicek dalam unit fisik dan qty SAP (`qty_out`/`sap_out` dikurangi yang sudah diretur). Retur utuh = semua sisa memakai sisa SAP persis hanya kalau bedanya sekadar pembulatan; setelah ada unit tidak utuh, sisa SAP > sisa unit × faktor dan unit utuh tetap qty × faktor. Remark operator maksimal 200 karakter. Pesan sukses menyebut nomor pallet sisa (untuk label pallet fisiknya).
- `users`: **tidak pernah di-DELETE** (`transactions.user_id` FK ke sini). User yang keluar → `is_active = 0`. Username tidak bisa diubah setelah dibuat. Admin tidak bisa mengubah role / menonaktifkan akun sendiri, dan harus tersisa minimal satu admin aktif (dicek dengan `FOR UPDATE` di dalam transaction).
- Lokasi TIDAK disimpan, diturunkan dari nama bin (`Dashboard::LOCATIONS`): rak `A-`–`D-` = Gudang 40, `E-`–`F-` = Gudang 50, `FLOOR 40`, `FLOOR 50`. `STAGE` tidak dihitung okupansi.

## Aturan frontend

- Vanilla ES Modules, tanpa framework. State di scope modul, DOM digambar ulang dari state. Event delegation di elemen induk yang stabil.
- Semua data yang masuk `innerHTML` wajib lewat `escapeHtml()`.
- Fetch yang bisa basi (ketik cepat / pindah halaman) memakai penanda `requestId`. Filter saat mengetik memakai `debounce`.
- Router: `public/utilities/router.js`, URL hash dengan parameter (mis. `#retur?code=RMPMOB...`; `#outbound` / `#bintobin?item=..&exp=..&pallet=..` dari popup Stock Overview = isi otomatis sekali pakai, URL lalu dibersihkan dengan `replaceParams`). Halaman memanggil `navigateTo()` dari router, bukan dari main.js (menghindari import melingkar).
- **Path fetch selalu relatif**: `controller/Xxx.php`, JANGAN `/wms-rmpm/controller/...` (supaya tidak terikat nama folder/host).
- **Request ke controller memakai `apiFetch()` dari `utilities/auth.js`, bukan `fetch()` langsung.** Kalau server membalas 401, `apiFetch` membuka popup login ulang lalu mengirim ulang request yang sama (isi form tidak hilang). Hanya `auth.js` sendiri yang memakai `fetch()` (login/logout/me). `auth.js` tidak boleh meng-import apa pun dari project (tools.js & users.js meng-import auth.js).
- **Pembaruan aplikasi di HP** (tanpa build, tanpa nomor versi manual):
  - `.htaccess` mengirim `Cache-Control: no-cache` untuk html/js/css: HP tetap menyimpan file, tapi selalu bertanya ke server (304 kalau sama).
  - Setiap respons PHP membawa header `X-App-Version` = `appVersion()` (helper.php, sidik jari `index.html` + `public/`; perubahan PHP saja tidak dihitung). `request()` di auth.js membandingkannya dengan versi saat halaman dibuka.
  - Versi baru → `main.js` memuat ulang otomatis saat pindah menu atau saat operator kembali ke aplikasi, KECUALI ada daftar yang belum di-Submit (atau, saat kembali ke aplikasi, ada isian form yang sudah diketik); selama itu tampil banner + tombol Muat ulang (minta konfirmasi kalau ada daftar). Halaman baru yang punya daftar sementara wajib `export function hasUnsubmitted()` dan didaftarkan di `hasUnsubmittedList()` (main.js).
  - `index.html` memuat main.js lewat `import()`: kalau gagal (campuran file lama/baru dari cache), semua file JS/CSS diambil ulang lalu halaman dimuat ulang, sekali per tab.
- Menu navbar digambar dari `MENU_GROUPS` di `main.js`, disaring `canOpen(page)` (daftar `pages` dari server saat login). Menu baru: tambahkan di `MENU_GROUPS` DAN di `ROLE_PAGES` (helper.php). Menyembunyikan menu hanya tampilan; penjaganya `requireLogin('menu')` di controller.
- Item code = 9 digit angka → pakai `ITEM_CODE_PATTERN` dari `utilities/materialAutocomplete.js` (bukan `length === 9`). Input item code di Inbound/Outbound/Bin to Bin memakai `materialAutocomplete()` (ketik deskripsi → pilih → input diganti item code). Outbound & Bin to Bin hanya menyarankan material yang ada stoknya.
- Bin to Bin: source bin otomatis dicari saat panjangnya 9 karakter (scan QR rak). Ini disengaja, pallet di floor dicari lewat scan item code. Quantity bisa diedit; pilihan "Pallet Tujuan" = Pindah utuh + pallet item & exp sama di target bin (dimuat saat Target Bin berubah; beda supplier/faktor tampil nonaktif). Qty sebagian → otomatis gabung ke pallet pertama yang boleh; qty = semua isi → default Pindah utuh (perilaku lama), walau di target bin ada pallet yang sama; ini keputusan Hariri, operator memilih "Gabung" sendiri (dibantu petunjuk di bawah field).
- Tombol di samping input (di dalam `.input-group`): `scanButtonHtml(id, 'item'|'bin')` (`utilities/scanner.js`, scan kamera) dan `binButtonsHtml(id)` (`utilities/binPicker.js`, popup Pilih Bin `A-01-A-01` + tombol scan). Kliknya ditangani satu listener global (`initScanButtons` / `initBinPickerButtons` di main.js); hasilnya masuk lewat `setInputValue()` (tools.js) yang memicu event `input` halaman. Susunan rak (baris A–F, nomor 1–17, level A–C, posisi 1–3) ada di atas binPicker.js. Kamera langsung butuh HTTPS atau localhost; di http biasa tombol scan otomatis memakai foto (`<input type="file" capture>`). Semua label gudang berupa QR code: scanner hanya membaca QR (`FORMATS`), kotak bidik persegi. Kamera bisa dipilih di popup scan; pilihan disimpan per HP di `localStorage` (`wms-rmpm.scan-camera`).
- Library JS disimpan lokal di `public/vendor/` (Chart.js, signature_pad, html5-qrcode untuk scan QR, dimuat saat scan pertama). Jangan pakai CDN, gudang tidak selalu ada internet.

## Styling

- CSS biasa, satu file `public/style.css` (dimuat di `index.html`). Halaman cetak punya CSS sendiri di `view/transaction_print.php`. Jangan menulis `<style>` atau `style="..."` di template JS, kecuali nilai dari data (lebar meter, warna seri grafik).
- Warna & ukuran lewat variabel di `:root` (`--accent: #e08600`, dst.). Teks di atas tombol oranye memakai `--on-accent` (gelap), bukan putih (kontras putih hanya 2,8:1). Teks/link oranye di atas putih memakai `--accent-strong`.
- Breakpoint: `< 1024px` menu samping jadi laci (tombol ☰ di `.topbar`), `< 640px` = HP. Layar sentuh (`pointer: coarse`) tinggi kontrol 44px.
- Pola markup halaman: `.page-header` (judul) → `section.card` → `.form-grid` berisi `.field` (label di atas input; `.wide` = 2 kolom, `.full` = satu baris; `<hr>` = pemisah kelompok) → `.form-actions`. Qty + UoM: `.input-group` + `.unit`. Tabel selalu dibungkus `.table-wrap` (bisa digeser di HP); kolom angka `class="num"`, teks panjang `class="wrap"`; tabel kosong pakai `emptyRowHtml()` (tools.js).
- Tombol (warna = arti): `.btn-primary` oranye = aksi utama/simpan (Submit, Move, Simpan, Print), `.btn-soft` oranye muda = aksi kedua (Add, Retur), `.btn-success` hijau = Export, `.btn-success-soft` = Aktifkan, `.btn-danger` merah muda = Hapus/Nonaktifkan, tanpa kelas = netral (Batal, Tutup, Reset). `.btn-sm` di baris tabel, `.link-btn` tampil seperti link. Jenis transaksi: `.badge .badge-inbound|outbound|mutasi|retur`.
- Ikon: `public/icons.css` (SVG digambar sendiri, lokal, tanpa CDN). Pakai atribut `data-icon="nama"` di elemen mana pun, ikon muncul di depan teks dan warnanya ikut warna teks. Tombol ikon saja wajib `aria-label`. Ikon menu ada di kolom ketiga `MENU_GROUPS`. Menambah ikon: salin satu baris `[data-icon="..."]` di icons.css. `::before` pada elemen ber-`data-icon` sudah dipakai ikon, jadi hiasan lain pakai `::after`.
- Filter di atas tabel: `section.card.filter-bar` → `.filter-toggle` (hanya tampil di HP, panel tertutup dulu + badge jumlah filter aktif) → `.filter-fields` (field `.grow` = melebar, `.fit` = selebar isinya). Rentang tanggal: `.date-range` > `.range-part[data-label]` (tgl + jam) `.range-sep`. Pilihan banyak (mis. Jenis): `.dropdown` + `dropdown()` dari `utilities/dropdown.js`, isinya `.check-item`. Export ada di `.page-header`, bukan di filter.
- **Jangan pakai `alert()` / `confirm()`.** Pesan: `toast(pesan, 'success'|'error'|'warning'|'info')` dari `utilities/toast.js` (notifikasi kecil di atas, hilang sendiri; `warning` = isian form belum benar, `error` = ditolak server / jaringan). Konfirmasi: `await confirmDialog({ title, message, confirmText, icon, danger })` dari `popups.js` (true/false).
- Popup pilihan (pilih pallet): baris `<tr class="pick-row" data-index tabindex="0">` + `onRowPick(box, index => ...)` dari `popups.js`. Klik baris / Enter = pilih, tanpa tombol "Pilih".

## Login & User Management (sudah jadi)

- Backend: `controller/UsersController.php` (class, satu method per aksi, dipilih lewat tabel `$routes` + `?action=`), SQL di `model/UsersModel.php`, fungsi sesi & hak akses di `config/helper.php`.
- Frontend: `public/utilities/auth.js` (layar login, popup login ulang, `apiFetch`, `canOpen`), `public/pages/users.js` (menu User + popup Ganti Password dari navbar).
- Belum ada: batas percobaan login (brute force).
