import { setContent, q, escapeHtml, formatNumber, binDatalistHtml, emptyRowHtml } from "../utilities/tools.js";
import { apiFetch } from "../utilities/auth.js";
import { toast } from "../utilities/toast.js";
import { replaceParams } from "../utilities/router.js";

// Retur: barang dari PRODUKSI/QUALITY kembali ke gudang, ke nomor pallet asalnya.
// Alur: muat dokumen OUTBOUND -> pilih pallet -> isi qty (dan bin kalau pallet sudah kosong)
//       -> Add ke daftar -> Submit.

const API = 'controller/ReturController.php';

// State halaman (scope modul).
let refCode = '';        // kode dokumen outbound yang sedang dimuat
let lines = [];          // pallet-pallet dokumen itu (dari server)
let selected = null;     // pallet yang sedang dipilih di form
let cart = [];           // pallet yang sudah di-Add, belum di-submit
let requestId = 0;

// params datang dari router, mis. { code: 'RMPMOB26090007' } saat dibuka dari popup transaksi.
export function retur(params = {}){
    setContent(`
        <div class="page-header"><h2>Retur</h2></div>

        <section class="card">
            <div class="form-grid">
                <div class="field wide">
                    <label for="ref-code">ID Transaksi Outbound</label>
                    <div class="input-group">
                        <input type="text" id="ref-code" placeholder="RMPMOB...">
                        <button type="button" id="btn-load" class="btn-primary" data-icon="search">Muat</button>
                    </div>
                    <p class="hint" id="ref-info"></p>
                </div>
            </div>

            <div class="table-wrap mt">
                <table>
                    <thead>
                        <tr>
                            <th>Item Code</th><th>Description</th><th>Exp Date</th><th class="num">Pallet</th><th>Asal</th>
                            <th class="num">Keluar</th><th class="num">Sudah Diretur</th><th class="num">Sisa</th>
                            <th>Posisi Pallet Sekarang</th><th></th>
                        </tr>
                    </thead>
                    <tbody id="lines-body"></tbody>
                </table>
            </div>
        </section>

        <section class="card">
            <h3 class="card-title">Pallet Dipilih</h3>
            <div class="callout" id="sel-info">Belum ada. Klik Pilih pada tabel pallet di atas.</div>
            <div class="form-grid">
                <div class="field">
                    <label for="qty">Qty Retur</label>
                    <div class="input-group">
                        <input type="number" id="qty" min="0" step="any" disabled>
                        <span class="unit" id="sel-uom"></span>
                    </div>
                </div>
                <div class="field">
                    <label for="qty-sap">Qty SAP</label>
                    <div class="input-group">
                        <input type="text" id="qty-sap" disabled>
                        <span class="unit" id="sel-uom-sap"></span>
                    </div>
                </div>
                <div class="field wide">
                    <label for="bin">Bin</label>
                    <input type="text" id="bin" list="bin-options" disabled>${binDatalistHtml()}
                    <small class="hint" id="bin-hint"></small>
                </div>
            </div>
            <div class="form-actions">
                <button type="button" id="btn-add" class="btn-soft" data-icon="plus" disabled>Add</button>
            </div>
        </section>

        <section class="card">
            <h3 class="card-title">Daftar Retur <span class="badge" id="cart-count">0</span></h3>
            <div class="form-grid mb">
                <div class="field full">
                    <label for="remark">Remark</label>
                    <input type="text" id="remark" placeholder="opsional, ditambahkan setelah 'Retur dari transaksi ...'">
                </div>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Item Code</th><th>Description</th><th>Exp Date</th><th class="num">Pallet</th>
                            <th class="num">Qty</th><th>UoM</th><th class="num">Qty SAP</th><th>Bin</th><th></th>
                        </tr>
                    </thead>
                    <tbody id="cart-body"></tbody>
                </table>
            </div>
            <div class="form-actions">
                <button type="button" id="btn-submit" class="btn-primary" data-icon="save">Submit</button>
            </div>
        </section>
    `);

    q('#btn-load').addEventListener('click', () => loadReference(q('#ref-code').value));
    q('#ref-code').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loadReference(q('#ref-code').value);
    });
    q('#lines-body').addEventListener('click', handlePick);
    q('#qty').addEventListener('input', previewQtySap);
    q('#btn-add').addEventListener('click', handleAdd);
    q('#cart-body').addEventListener('click', handleDeleteCart);
    q('#btn-submit').addEventListener('click', handleSubmit);

    renderCart();
    renderLines();

    // Dibuka dengan ID (dari popup transaksi) -> langsung muat dokumen itu.
    // Dibuka dari menu tanpa ID -> tampilkan lagi dokumen terakhir (kalau ada).
    const code = (params.code || refCode || '').trim();
    if (code) {
        q('#ref-code').value = code;
        loadReference(code);
    }
}

// Kunci identitas pallet.
function keyOf(row){
    return `${row.item_code}|${row.exp_date}|${Number(row.pallet_number)}`;
}

// Sisa yang boleh diretur untuk satu pallet, dikurangi yang sudah ada di daftar (cart).
function remainingOf(line){
    const inCart = cart.filter(c => keyOf(c) === keyOf(line)).reduce((sum, c) => sum + c.qty_actual, 0);
    return Math.max(0, parseFloat(line.qty_out) - parseFloat(line.qty_returned) - inCart);
}

async function loadReference(rawCode){
    const code = rawCode.trim().toUpperCase();
    if (!code) {
        toast('Isi ID transaksi outbound dulu', 'warning');
        return;
    }

    // Ganti dokumen -> daftar retur dokumen sebelumnya dikosongkan.
    if (code !== refCode) {
        cart = [];
        renderCart();
    }

    const myRequest = ++requestId;
    q('#ref-info').textContent = 'Memuat...';

    try {
        const res = await apiFetch(`${API}?code=${encodeURIComponent(code)}`);
        const result = await res.json();

        if (myRequest !== requestId || !q('#lines-body')) return; // jawaban basi

        selectLine(null);

        if (!result.success) {
            refCode = '';
            lines = [];
            renderLines();
            q('#ref-info').textContent = result.error;
            return;
        }

        refCode = result.reference_code;
        lines = result.data;
        q('#ref-code').value = refCode;
        replaceParams('retur', { code: refCode }); // URL ikut dokumen yang tampil
        q('#ref-info').textContent = `Dokumen ${refCode}, keluar ${lines[0].created_at}, ${lines.length} pallet.`;
        renderLines();

    } catch (err) {
        if (myRequest !== requestId || !q('#ref-info')) return;
        q('#ref-info').textContent = 'Tidak bisa menghubungi server: ' + err.message;
    }
}

function renderLines(){
    if (lines.length === 0) {
        q('#lines-body').innerHTML = emptyRowHtml(10, 'Isi ID transaksi outbound lalu klik Muat.');
        return;
    }

    q('#lines-body').innerHTML = lines.map((line, index) => {
        const remaining = remainingOf(line);
        const stockQty = parseFloat(line.stock_qty);
        const position = stockQty > 0
            ? `${line.stock_bin} (isi ${formatNumber(stockQty)})`
            : 'kosong';

        return `
            <tr>
                <td>${escapeHtml(line.item_code)}</td>
                <td class="wrap">${escapeHtml(line.description)}</td>
                <td>${escapeHtml(line.exp_date)}</td>
                <td class="num">${escapeHtml(line.pallet_number)}</td>
                <td>${escapeHtml(line.destination)}</td>
                <td class="num">${formatNumber(line.qty_out)} ${escapeHtml(line.uom_fisik)}</td>
                <td class="num">${formatNumber(line.qty_returned)}</td>
                <td class="num">${formatNumber(remaining)}</td>
                <td>${escapeHtml(position)}</td>
                <td>
                    ${remaining > 0
                        ? `<button type="button" class="btn-pick btn-sm btn-soft" data-index="${index}" data-icon="check">Pilih</button>`
                        : '<span class="badge badge-active" data-icon="check">Selesai</span>'}
                </td>
            </tr>
        `;
    }).join('');
}

function handlePick(e){
    const button = e.target.closest('.btn-pick');
    if (!button) return;

    selectLine(lines[Number(button.dataset.index)]);
}

// Isi form sesuai pallet yang dipilih. Aturan bin:
// - pallet sudah kosong -> bin wajib diisi (pallet "hidup lagi" di lokasi baru)
// - pallet masih ada isi -> barang ditaruh ke pallet yang sama, bin tidak berubah
function selectLine(line){
    selected = line;

    const ready = Boolean(line);
    q('#qty').disabled = !ready;
    q('#btn-add').disabled = !ready;

    if (!line) {
        q('#sel-info').textContent = 'Belum ada. Klik Pilih pada tabel pallet di atas.';
        q('#qty').value = '';
        q('#bin').value = '';
        q('#bin').disabled = true;
        q('#bin-hint').textContent = '';
        q('#sel-uom').textContent = '';
        q('#sel-uom-sap').textContent = '';
        previewQtySap();
        return;
    }

    q('#sel-info').textContent = `${line.item_code} ${line.description}, exp ${line.exp_date}, pallet ${line.pallet_number}`;
    q('#sel-uom').textContent = line.uom_fisik;
    q('#sel-uom-sap').textContent = line.uom_sap;
    q('#qty').value = remainingOf(line);   // default: semua sisa kembali

    const palletEmpty = parseFloat(line.stock_qty) <= 0;
    q('#bin').disabled = !palletEmpty;
    q('#bin').value = palletEmpty ? '' : line.stock_bin;
    q('#bin-hint').textContent = palletEmpty
        ? 'Pallet sudah kosong: isi bin tempat barang retur ditaruh.'
        : 'Pallet masih ada isinya: barang retur masuk ke pallet yang sama, bin tetap.';

    previewQtySap();
    q('#qty').focus();
}

// Hanya untuk ditampilkan. Server menghitung ulang dengan faktor pallet yang sama.
function previewQtySap(){
    const qty = parseFloat(q('#qty').value);
    const factor = parseFloat(selected?.conversion_factor);
    q('#qty-sap').value = (qty > 0 && factor > 0) ? (qty * factor).toFixed(3) : '';
}

function handleAdd(){
    if (!selected) return;

    const qty = parseFloat(q('#qty').value);
    const remaining = remainingOf(selected);
    const palletEmpty = parseFloat(selected.stock_qty) <= 0;
    const bin = q('#bin').value.trim().toUpperCase();

    if (cart.some(c => keyOf(c) === keyOf(selected))) {
        toast('Pallet ini sudah ada di daftar. Hapus dulu kalau mau mengubah qty.', 'warning');
        return;
    }
    if (!(qty > 0)) {
        toast('Qty retur harus lebih dari 0', 'warning');
        return;
    }
    if (qty > remaining + 0.0005) {
        toast(`Qty retur maksimal ${formatNumber(remaining)}`, 'warning');
        return;
    }
    if (palletEmpty && !bin) {
        toast('Pallet sudah kosong, bin wajib diisi', 'warning');
        return;
    }

    cart.push({
        item_code:     selected.item_code,
        description:   selected.description,
        exp_date:      selected.exp_date,
        pallet_number: Number(selected.pallet_number),
        qty_actual:    qty,
        uom_fisik:     selected.uom_fisik,
        qty_sap:       q('#qty-sap').value,
        bin:           palletEmpty ? bin : selected.stock_bin,
    });

    selectLine(null);
    renderCart();
    renderLines(); // kolom "Sisa" ikut berkurang
}

function renderCart(){
    q('#cart-count').textContent = cart.length;

    if (cart.length === 0) {
        q('#cart-body').innerHTML = emptyRowHtml(9, 'Belum ada pallet retur. Pilih pallet, isi qty, lalu klik Add.');
        return;
    }

    q('#cart-body').innerHTML = cart.map((row, index) => `
        <tr>
            <td>${escapeHtml(row.item_code)}</td>
            <td class="wrap">${escapeHtml(row.description)}</td>
            <td>${escapeHtml(row.exp_date)}</td>
            <td class="num">${escapeHtml(row.pallet_number)}</td>
            <td class="num">${formatNumber(row.qty_actual)}</td>
            <td>${escapeHtml(row.uom_fisik)}</td>
            <td class="num">${escapeHtml(row.qty_sap)}</td>
            <td>${escapeHtml(row.bin)}</td>
            <td><button type="button" class="btn-delete btn-sm btn-danger" data-index="${index}" data-icon="trash">Hapus</button></td>
        </tr>
    `).join('');
}

function handleDeleteCart(e){
    const button = e.target.closest('.btn-delete');
    if (!button) return;

    cart.splice(Number(button.dataset.index), 1);
    renderCart();
    renderLines();
}

async function handleSubmit(){
    if (!refCode || cart.length === 0) {
        toast('Belum ada pallet yang di-Add', 'warning');
        return;
    }

    const button = q('#btn-submit');
    button.disabled = true;

    // Bentuk "object berisi array": satu dokumen referensi, banyak pallet.
    const payload = {
        reference_code: refCode,
        remark: q('#remark').value.trim(),
        items: cart.map(c => ({
            item_code: c.item_code,
            exp_date: c.exp_date,
            pallet_number: c.pallet_number,
            qty_actual: c.qty_actual,
            bin: c.bin,
        })),
    };

    try {
        const res = await apiFetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await res.json();

        if (result.success) {
            toast('Retur berhasil disimpan: ' + result.transaction_code, 'success');
            cart = [];
            q('#remark').value = '';
            renderCart();
            loadReference(refCode); // muat ulang supaya "Sudah Diretur" & posisi pallet terbaru
        } else {
            toast('Gagal: ' + result.error, 'error');
        }
    } catch (err) {
        toast('Tidak bisa menghubungi server: ' + err.message, 'error');
    } finally {
        button.disabled = false;
    }
}
