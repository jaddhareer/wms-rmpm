import { setContent, q, escapeHtml, binDatalistHtml, fetchPallet, emptyRowHtml, formatNumber, sumByUnit, debounce } from "../utilities/tools.js";
import { apiFetch } from "../utilities/auth.js";
import { toast } from "../utilities/toast.js";
import { openPalletChecklist } from "../utilities/palletChecklist.js";
import { materialAutocomplete, ITEM_CODE_PATTERN } from "../utilities/materialAutocomplete.js";
import { replaceParams } from "../utilities/router.js";
import { scanButtonHtml } from "../utilities/scanner.js";
import { binButtonsHtml } from "../utilities/binPicker.js";

// Alur: scan Source Bin (isi satu bin) atau Item Code (pallet item itu di semua bin) -> popup
// checklist -> pallet yang dicentang masuk tabel "Pallet Dipindah" -> isi Target Bin -> Move.
// Satu Move = satu dokumen MUTASI untuk semua baris (BinToBin.php). Per baris:
//   qty = isi pallet  -> Pindah utuh (pallet ikut pindah bin), atau Gabung
//   qty lebih kecil   -> bagian itu Gabung ke pallet item & exp sama di Target Bin, atau Pallet baru

// Pallet yang akan dipindah (baris StockController) + isian per baris:
//   available = isi pallet saat dipilih, qty = yang dipindah, target = '' | nomor pallet | NEW_PALLET,
//   targetChosen = true kalau Pallet Tujuan dipilih sendiri oleh operator (lihat targetOptions)
let list = [];

// Pallet berisi di target bin (semua item). Calon pallet tujuan gabung = yang item + exp-nya sama.
let targetBinPallets = [];
let targetRequestId = 0;
let sourceRequestId = 0;

// Nilai pilihan Pallet Tujuan "Pallet baru" (sama dengan yang dibaca BinToBin.php):
// sebagian isi pallet asal jadi pallet baru di target bin.
const NEW_PALLET = 'new';

// Masih ada pallet di daftar yang belum di-Move? (lihat hasUnsubmitted di Inbound.js)
export function hasUnsubmitted(){
    return list.length > 0;
}

// params dari router. Dibuka dari popup Stock Overview -> { item, exp, pallet }:
// pallet itu langsung masuk daftar, operator tinggal mengisi Target Bin.
export function bintobin(params = {}){
    targetBinPallets = [];

    setContent(`
        <div class="page-header"><h2>Bin to Bin</h2></div>

        <section class="card">
            <div class="form-grid">
                <div class="field">
                    <label for="source-bin">Source Bin</label>
                    <div class="input-group">
                        <input type="text" id="source-bin" placeholder="A-01-A-01">
                        ${binButtonsHtml('source-bin')}
                    </div>
                </div>
                <div class="field">
                    <label for="item-code">Item Code</label>
                    <div class="input-group">
                        <input type="text" id="item-code">
                        ${scanButtonHtml('item-code', 'item')}
                    </div>
                </div>
                <div class="field">
                    <label for="target-bin">Target Bin</label>
                    <div class="input-group">
                        <input type="text" id="target-bin" list="bin-options" placeholder="A-01-A-02">
                        ${binButtonsHtml('target-bin')}
                    </div>${binDatalistHtml()}
                </div>
            </div>
            <p class="hint mt">Scan Source Bin (isi satu bin rak) atau Item Code (pallet item itu di semua bin, termasuk floor), lalu centang pallet yang dipindah.</p>
        </section>

        <section class="card">
            <h3 class="card-title">
                Pallet Dipindah <span class="badge" id="list-count">0</span>
                <span class="card-summary" id="list-total"></span>
            </h3>
            <p class="table-info">Qty dikurangi = pindah sebagian: bagian itu jadi Pallet baru di Target Bin, atau Gabung ke pallet item & exp yang sama di sana. Sisanya tetap di pallet asal.</p>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Item Code</th><th>Description</th><th>Exp Date</th><th class="num">Pallet</th><th>Source Bin</th>
                            <th class="num">Isi Pallet</th><th class="num">Qty</th><th>UoM</th><th>Pallet Tujuan</th><th>Remark</th><th></th>
                        </tr>
                    </thead>
                    <tbody id="list-body"></tbody>
                </table>
            </div>
            <div class="form-actions">
                <button type="button" id="btn-move" class="btn-primary" data-icon="swap">Move</button>
            </div>
        </section>
    `);

    // Source bin: dicari otomatis begitu panjangnya 9 karakter (hasil scan QR rak).
    // Pallet di floor tidak punya QR bin -> operator cukup scan item code.
    q('#source-bin').addEventListener('input', () => {
        const bin = q('#source-bin').value.trim();
        if (bin.length === 9) loadPallets('bin', bin);
    });
    q('#item-code').addEventListener('input', () => {
        // Hanya item code 9 digit angka. Deskripsi 9 huruf (mis. "quadriple") tidak
        // boleh ikut mencari stok; deskripsi dipilih lewat saran autocomplete.
        const itemCode = q('#item-code').value.trim();
        if (ITEM_CODE_PATTERN.test(itemCode)) loadPallets('item', itemCode);
    });
    // Ketik deskripsi -> pilih saran -> sama seperti scan item code.
    // Hanya material yang masih ada stoknya yang disarankan.
    materialAutocomplete(q('#item-code'), {
        inStockOnly: true,
        onSelect: (material) => loadPallets('item', material.item_code),
    });

    // Target Bin berubah: pilihan Pallet Tujuan langsung menyesuaikan (bin sama / beda), lalu
    // isi target bin dimuat (debounce) untuk calon pallet Gabung.
    const debouncedLoadTarget = debounce(loadTargetPallets);
    q('#target-bin').addEventListener('input', () => {
        targetBinPallets = [];
        targetRequestId++; // isi target bin lama yang masih dimuat tidak dipakai lagi
        renderAllTargets();
        debouncedLoadTarget();
    });

    // Event delegation di tbody: baris digambar ulang setiap renderList().
    q('#list-body').addEventListener('input', handleQtyInput);
    q('#list-body').addEventListener('change', handleTargetChange);
    q('#list-body').addEventListener('click', handleDeleteRow);
    q('#btn-move').addEventListener('click', handleMove);

    renderList();

    if (params.item && params.exp && params.pallet) {
        preselectPallet(params);
    }
}

// Dibuka dari popup Stock Overview: pallet itu masuk daftar dengan stok terbarunya.
async function preselectPallet({ item, exp, pallet }){
    // Parameter ini perintah sekali pakai, bukan isi halaman. URL dibersihkan supaya
    // refresh / back-forward tidak menambah pallet yang sama lagi.
    replaceParams('bintobin');

    let found;
    try {
        found = await fetchPallet(item, exp, pallet);
    } catch (err) {
        toast('Gagal memuat pallet: ' + err.message, 'error');
        return;
    }

    if (!q('#list-body')) return; // sudah pindah halaman

    if (!found) {
        toast(`Pallet ${pallet} (${item}, exp ${exp}) sudah tidak ada stoknya`, 'warning');
        return;
    }
    if (list.some(row => samePallet(row, found))) {
        toast(`Pallet ${pallet} sudah ada di daftar`, 'warning');
        return;
    }

    addPallets([found]);
}

// Identitas pallet = item_code + exp_date + pallet_number.
// Number() karena dari PHP angka bisa datang sebagai string ("3" vs 3).
function samePallet(a, b){
    return a.item_code === b.item_code
        && a.exp_date === b.exp_date
        && Number(a.pallet_number) === Number(b.pallet_number);
}

// kind = 'bin' (isi satu source bin) atau 'item' (pallet item itu di semua bin).
async function loadPallets(kind, value){
    const myRequest = ++sourceRequestId;
    const param = kind === 'bin' ? 'source_bin' : 'item_code';
    const label = kind === 'bin' ? `bin ${value.toUpperCase()}` : `item ${value}`;

    let data;
    try {
        const res = await apiFetch(`controller/StockController.php?${param}=${encodeURIComponent(value)}`);
        data = await res.json();
        if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
    } catch (err) {
        if (myRequest === sourceRequestId) toast('Gagal memuat pallet: ' + err.message, 'error');
        return;
    }

    // Abaikan jawaban basi (scan berikutnya sudah jalan / sudah pindah halaman).
    if (myRequest !== sourceRequestId || !q('#list-body')) return;

    if (!Array.isArray(data) || data.length === 0) {
        toast(`Tidak ada stok tersisa untuk ${label}`, 'warning');
        return;
    }

    // Pallet yang sudah ada di daftar tidak ditawarkan lagi.
    const pallets = data.filter(pallet => !list.some(row => samePallet(row, pallet)));
    if (pallets.length === 0) {
        toast(`Semua pallet ${label} sudah ada di daftar`, 'warning');
        return;
    }

    openPalletChecklist({
        title: kind === 'bin' ? `Isi ${label}` : `Pilih pallet: ${pallets[0].description}`,
        hint: 'Urut dari expired paling dekat (FEFO). Centang pallet yang dipindah; qty yang dipindah sebagian diubah di tabel setelah Add.',
        pallets,
        showItem: kind === 'bin', // isi satu bin bisa beda-beda item
        onAdd: addPallets,
    });
}

// Masukkan pallet-pallet yang dicentang ke daftar, qty awal = semua isi pallet (pindah utuh).
function addPallets(pallets){
    const added = pallets.filter(pallet => !list.some(row => samePallet(row, pallet)));

    for (const pallet of added) {
        const available = parseFloat(pallet.qty_actual);
        list.push({ ...pallet, available, qty: available, target: '', targetChosen: false });
    }

    toast(`${added.length} pallet ditambahkan ke daftar`, 'success');

    // Remark stok (mis. REJECT dari Stock Overview) hanya diinformasikan, tidak memblokir.
    const remarks = added.filter(p => p.remark).map(p => `pallet ${p.pallet_number} exp ${p.exp_date}: ${p.remark}`);
    if (remarks.length > 0) toast(`Remark ${remarks.join(' · ')}`, 'info');

    // Siap untuk scan berikutnya; Target Bin dulu kalau belum diisi.
    q('#source-bin').value = '';
    q('#item-code').value = '';
    (q('#target-bin').value.trim() ? q('#source-bin') : q('#target-bin')).focus();

    renderList();
    return true;
}

// Isi target bin dicari setiap kali Target Bin berubah (lewat debounce).
// requestId: jawaban lama yang datang terlambat (bin sudah diganti) diabaikan.
async function loadTargetPallets(){
    const myRequest = ++targetRequestId;
    const targetBin = q('#target-bin')?.value.trim();

    if (!targetBin) {
        targetBinPallets = [];
        renderAllTargets();
        return;
    }

    try {
        const response = await apiFetch(`controller/StockController.php?source_bin=${encodeURIComponent(targetBin)}`);
        const data = await response.json();
        if (myRequest !== targetRequestId) return;
        targetBinPallets = Array.isArray(data) ? data : [];
    } catch (err) {
        if (myRequest !== targetRequestId) return;
        targetBinPallets = [];
        toast('Gagal memuat isi target bin: ' + err.message, 'error');
    }
    renderAllTargets();
}

function targetBin(){
    return q('#target-bin')?.value.trim().toUpperCase() ?? '';
}

// Qty lebih kecil dari isi pallet = pindah sebagian: bagian itu digabung ke pallet tujuan,
// atau jadi pallet baru di target bin.
function isPartial(row){
    return Number.isFinite(row.qty) && row.qty < row.available - 0.0005;
}

// Source dan Target Bin sama (mis. dua pallet di FLOOR 40): pindah / pecah tidak mengubah
// apa pun, yang berlaku hanya gabung ke pallet lain di bin itu.
function isSameBin(row){
    const target = targetBin();
    return target !== '' && String(row.bin).trim().toUpperCase() === target;
}

// Calon pallet tujuan: pallet item + exp yang sama di target bin, selain pallet asal. Pallet
// yang ada di daftar ini tidak ikut (ia sendiri sedang dipindah, urutannya jadi membingungkan).
function targetCandidates(row){
    return targetBinPallets.filter(p =>
        p.item_code === row.item_code && p.exp_date === row.exp_date
        && Number(p.pallet_number) !== Number(row.pallet_number)
        && !list.some(other => samePallet(other, p)));
}

// Alasan pallet tidak boleh digabung (cek yang sama ada di BinToBin.php). '' = boleh.
function mismatchReason(row, pallet){
    const supplierOf = p => (p.supplier ?? '').trim().toLowerCase();
    if (supplierOf(pallet) !== supplierOf(row)) return 'beda supplier';
    if (Math.abs(Number(pallet.conversion_factor) - Number(row.conversion_factor)) > 0.00005) return 'beda faktor konversi';
    return '';
}

// Pilihan Pallet Tujuan satu baris. Sekaligus menyesuaikan row.target: pilihan operator
// dipertahankan selama masih boleh. Selain itu default dihitung ulang setiap kali (qty, Target
// Bin, atau isi target bin berubah): qty sebagian (atau bin yang sama) -> gabung ke pallet
// pertama yang boleh (kalau tidak ada: pallet baru), qty utuh -> pindah utuh (perilaku Bin to Bin
// lama, walau di target bin ada pallet yang sama; operator memilih Gabung sendiri).
// Default tidak "dikunci" karena isi target bin dimuat belakangan: tanpa ini, baris qty sebagian
// sempat jadi Pallet baru (calon Gabung belum ada) dan tetap begitu setelah isinya termuat.
function targetOptions(row){
    const partial = isPartial(row);
    const sameBin = isSameBin(row);
    const options = [
        { value: '', label: 'Pindah utuh', disabled: partial || sameBin },
        ...targetCandidates(row).map(p => {
            const reason = mismatchReason(row, p);
            return {
                value: String(p.pallet_number),
                label: `Gabung ke pallet ${p.pallet_number} (isi ${formatNumber(p.qty_actual)} ${p.uom_fisik})` + (reason ? ` - ${reason}` : ''),
                disabled: Boolean(reason),
            };
        }),
        { value: NEW_PALLET, label: 'Pallet baru (pecah)', disabled: sameBin || !partial },
    ];

    const allowed = options.filter(o => !o.disabled).map(o => o.value);
    if (!(row.targetChosen && allowed.includes(row.target))) {
        row.targetChosen = false;
        row.target = (partial || sameBin) ? (allowed[0] ?? '') : '';
    }
    return options;
}

function targetOptionsHtml(row){
    return targetOptions(row).map(o => `
        <option value="${escapeHtml(o.value)}"${o.disabled ? ' disabled' : ''}${o.value === row.target ? ' selected' : ''}>${escapeHtml(o.label)}</option>
    `).join('');
}

// Pesan kalau baris ini belum bisa dipindah, atau null.
function rowProblem(row){
    if (!(row.qty > 0)) return 'quantity harus lebih dari 0';
    if (row.qty > row.available + 0.0005) return `quantity melebihi isi pallet (${formatNumber(row.available)} ${row.uom_fisik})`;
    if (isSameBin(row) && !row.target) return 'source dan target bin sama, dan tidak ada pallet yang bisa digabung';
    if (isPartial(row) && !row.target) return 'pindah sebagian: pilih Pallet Tujuan';
    return null;
}

function renderTotal(){
    q('#list-count').textContent = list.length;
    // textContent: UoM dari database aman tanpa escapeHtml.
    q('#list-total').textContent = list.length === 0 ? '' : `Total: ${sumByUnit(list, 'qty', 'uom_fisik', formatNumber)}`;
}

function renderList(){
    renderTotal();

    if (list.length === 0) {
        q('#list-body').innerHTML = emptyRowHtml(11, 'Belum ada pallet. Scan Source Bin / Item Code, centang pallet, lalu klik Add.');
        return;
    }

    q('#list-body').innerHTML = list.map((row, index) => `
        <tr>
            <td>${escapeHtml(row.item_code)}</td>
            <td class="wrap">${escapeHtml(row.description)}</td>
            <td>${escapeHtml(row.exp_date)}</td>
            <td class="num">${escapeHtml(row.pallet_number)}</td>
            <td>${escapeHtml(row.bin)}</td>
            <td class="num">${formatNumber(row.available)}</td>
            <td class="num">
                <input type="number" class="cell-qty${!(row.qty > 0) || row.qty > row.available + 0.0005 ? ' is-invalid' : ''}"
                       data-index="${index}" min="0" max="${row.available}" step="any"
                       value="${Number.isFinite(row.qty) ? row.qty : ''}"
                       aria-label="Qty pallet ${escapeHtml(row.pallet_number)} exp ${escapeHtml(row.exp_date)}">
            </td>
            <td>${escapeHtml(row.uom_fisik)}</td>
            <td>
                <select class="cell-target" data-index="${index}" aria-label="Pallet tujuan pallet ${escapeHtml(row.pallet_number)}">
                    ${targetOptionsHtml(row)}
                </select>
            </td>
            <td class="wrap">${escapeHtml(row.remark)}</td>
            <td><button type="button" class="btn-delete btn-sm btn-danger" data-index="${index}" data-icon="trash">Hapus</button></td>
        </tr>
    `).join('');
}

// Gambar ulang pilihan Pallet Tujuan satu baris / semua baris (qty atau Target Bin berubah).
// Hanya <select>-nya, supaya isian qty yang sedang diketik tidak kehilangan fokus.
function renderTarget(index){
    const select = q(`#list-body .cell-target[data-index="${index}"]`);
    if (select) select.innerHTML = targetOptionsHtml(list[index]);
}

function renderAllTargets(){
    if (!q('#list-body')) return; // sudah pindah halaman (jawaban fetch datang terlambat)
    list.forEach((_, index) => renderTarget(index));
}

// Qty diubah -> simpan ke state, sesuaikan pilihan Pallet Tujuan baris itu dan total.
function handleQtyInput(e){
    const input = e.target.closest('.cell-qty');
    const row = input && list[Number(input.dataset.index)];
    if (!row) return;

    row.qty = parseFloat(input.value); // NaN kalau dikosongkan
    input.classList.toggle('is-invalid', !(row.qty > 0) || row.qty > row.available + 0.0005);
    renderTarget(Number(input.dataset.index));
    renderTotal();
}

function handleTargetChange(e){
    const select = e.target.closest('.cell-target');
    const row = select && list[Number(select.dataset.index)];
    if (row) {
        row.target = select.value;
        row.targetChosen = true;
    }
}

function handleDeleteRow(e){
    const button = e.target.closest('.btn-delete');
    if (!button) return;

    list.splice(Number(button.dataset.index), 1);
    renderList(); // calon Gabung baris lain bisa berubah (pallet yang dihapus boleh jadi tujuan lagi)
}

async function handleMove(){
    const target = targetBin();

    if (list.length === 0) {
        toast('Belum ada pallet yang dipilih', 'warning');
        return;
    }
    if (!target) {
        toast('Isi Target Bin dulu', 'warning');
        q('#target-bin').focus();
        return;
    }

    // Pilihan Pallet Tujuan disesuaikan dulu dengan Target Bin & qty terakhir, lalu dicek.
    renderAllTargets();
    const invalid = list.findIndex(row => rowProblem(row) !== null);
    if (invalid >= 0) {
        const row = list[invalid];
        toast(`Baris ${invalid + 1} (pallet ${row.pallet_number}): ${rowProblem(row)}`, 'warning');
        q(`#list-body .cell-qty[data-index="${invalid}"]`)?.focus();
        return;
    }

    // Satu target bin untuk semua baris. Per baris: identitas pallet + bin asal + qty + pallet
    // tujuan (kosong = pindah utuh, nomor = gabung, 'new' = pecah). Qty SAP dihitung server.
    const body = {
        target_bin: target,
        items: list.map(row => ({
            source_bin:    row.bin,
            item_code:     row.item_code,
            exp_date:      row.exp_date,
            pallet_number: Number(row.pallet_number),
            qty_actual:    row.qty,
            target_pallet: row.target === NEW_PALLET ? NEW_PALLET : (row.target ? Number(row.target) : null),
        })),
    };

    const button = q('#btn-move');
    button.disabled = true;

    try {
        const res = await apiFetch('controller/BinToBin.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const result = await res.json();

        if (result.success) {
            toast(result.message, 'success');
            list = [];
            q('#target-bin').value = '';
            targetBinPallets = [];
            targetRequestId++; // isi target bin yang masih dimuat tidak dipakai lagi
            renderList();
            q('#source-bin').focus();
        } else {
            // Daftar tidak dikosongkan, supaya operator cukup membetulkan yang salah.
            toast('Gagal: ' + result.error, 'error');
        }
    } catch (err) {
        toast('Tidak bisa menghubungi server: ' + err.message, 'error');
    } finally {
        button.disabled = false;
    }
}
