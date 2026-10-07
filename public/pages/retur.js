import { setContent, q, escapeHtml, formatNumber, binDatalistHtml } from "../utilities/tools.js";
import { apiFetch } from "../utilities/auth.js";
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
        <h2>Retur</h2>

        <div>
            <label for="ref-code">ID Transaksi Outbound</label>
            <input type="text" id="ref-code" placeholder="RMPMOB..." size="20">
            <button type="button" id="btn-load">Muat</button>
        </div>
        <p id="ref-info"></p>

        <table border="1">
            <thead>
                <tr>
                    <th>Item Code</th><th>Description</th><th>Exp Date</th><th>Pallet</th><th>Asal</th>
                    <th>Keluar</th><th>Sudah Diretur</th><th>Sisa</th><th>Posisi Pallet Sekarang</th><th></th>
                </tr>
            </thead>
            <tbody id="lines-body"></tbody>
        </table>

        <hr>
        <div>
            <b>Pallet dipilih:</b> <span id="sel-info">-</span><br>
            <label for="qty">Qty Retur</label>
            <input type="number" id="qty" min="0" step="any" disabled> <span id="sel-uom"></span>
            &nbsp; Qty SAP: <input type="text" id="qty-sap" disabled size="10"> <span id="sel-uom-sap"></span><br>
            <label for="bin">Bin</label>
            <input type="text" id="bin" list="bin-options" disabled>${binDatalistHtml()}
            <small id="bin-hint"></small><br>
            <button type="button" id="btn-add" disabled>Add</button>
        </div>

        <hr>
        <label for="remark">Remark</label>
        <input type="text" id="remark" size="40" placeholder="opsional, ditambahkan setelah 'Retur dari transaksi ...'">

        <table border="1">
            <thead>
                <tr>
                    <th>Item Code</th><th>Description</th><th>Exp Date</th><th>Pallet</th>
                    <th>Qty</th><th>UoM</th><th>Qty SAP</th><th>Bin</th><th></th>
                </tr>
            </thead>
            <tbody id="cart-body"></tbody>
        </table>

        <button type="button" id="btn-submit">Submit</button>
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
        alert('Isi ID transaksi outbound dulu');
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
    q('#lines-body').innerHTML = lines.map((line, index) => {
        const remaining = remainingOf(line);
        const stockQty = parseFloat(line.stock_qty);
        const position = stockQty > 0
            ? `${line.stock_bin} (isi ${formatNumber(stockQty)})`
            : 'kosong';

        return `
            <tr>
                <td>${escapeHtml(line.item_code)}</td>
                <td>${escapeHtml(line.description)}</td>
                <td>${escapeHtml(line.exp_date)}</td>
                <td style="text-align:right">${escapeHtml(line.pallet_number)}</td>
                <td>${escapeHtml(line.destination)}</td>
                <td style="text-align:right">${formatNumber(line.qty_out)} ${escapeHtml(line.uom_fisik)}</td>
                <td style="text-align:right">${formatNumber(line.qty_returned)}</td>
                <td style="text-align:right">${formatNumber(remaining)}</td>
                <td>${escapeHtml(position)}</td>
                <td>
                    ${remaining > 0
                        ? `<button type="button" class="btn-pick" data-index="${index}">Pilih</button>`
                        : 'Selesai'}
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
        q('#sel-info').textContent = '-';
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
        alert('Pallet ini sudah ada di daftar. Hapus dulu kalau mau mengubah qty.');
        return;
    }
    if (!(qty > 0)) {
        alert('Qty retur harus lebih dari 0');
        return;
    }
    if (qty > remaining + 0.0005) {
        alert(`Qty retur maksimal ${formatNumber(remaining)}`);
        return;
    }
    if (palletEmpty && !bin) {
        alert('Pallet sudah kosong, bin wajib diisi');
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
    q('#cart-body').innerHTML = cart.map((row, index) => `
        <tr>
            <td>${escapeHtml(row.item_code)}</td>
            <td>${escapeHtml(row.description)}</td>
            <td>${escapeHtml(row.exp_date)}</td>
            <td style="text-align:right">${escapeHtml(row.pallet_number)}</td>
            <td style="text-align:right">${formatNumber(row.qty_actual)}</td>
            <td>${escapeHtml(row.uom_fisik)}</td>
            <td style="text-align:right">${escapeHtml(row.qty_sap)}</td>
            <td>${escapeHtml(row.bin)}</td>
            <td><button type="button" class="btn-delete" data-index="${index}">Hapus</button></td>
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
        alert('Belum ada pallet yang di-Add');
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
            alert('Retur berhasil disimpan: ' + result.transaction_code);
            cart = [];
            q('#remark').value = '';
            renderCart();
            loadReference(refCode); // muat ulang supaya "Sudah Diretur" & posisi pallet terbaru
        } else {
            alert('Gagal: ' + result.error);
        }
    } catch (err) {
        alert('Tidak bisa menghubungi server: ' + err.message);
    } finally {
        button.disabled = false;
    }
}
