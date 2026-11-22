import { escapeHtml, formatNumber, formatQtySap, sumByUnit } from "./tools.js";
import { openPopup, closePopup } from "./popups.js";

// Popup checklist: memilih BEBERAPA pallet sekaligus (Outbound, Bin to Bin).
// Klik baris (atau kotak centangnya) = centang / lepas, kotak di kepala tabel = centang semua.
// Total qty & qty SAP yang dicentang tampil di .popup-footer yang menempel di bawah popup,
// jadi tetap terlihat walau daftarnya panjang. Kolom Supplier selalu ada: kadang ada permintaan
// barang dari supplier tertentu walau bukan FEFO (Outbound), dan Gabung di Bin to Bin hanya
// boleh ke pallet yang supplier-nya sama.
//
//   openPalletChecklist({
//       title: 'Pilih pallet: UREA',
//       pallets,                                  // baris StockController, urut FEFO
//       showItem: false,                          // true = kolom Item Code + Description (isi satu bin: item bisa beda-beda)
//       isPreselected: (pallet) => ...,           // opsional: pallet yang langsung dicentang
//       onAdd: (checked) => true,                 // pallet yang dicentang (urut seperti di popup);
//   });                                           // return false = popup tetap terbuka
//
// Hanya satu pallet -> langsung dicentang.
export function openPalletChecklist({ title, hint = '', pallets, showItem = false, isPreselected = () => false, onAdd }){
    const checked = new Set(); // index di array pallets
    pallets.forEach((pallet, index) => {
        if (pallets.length === 1 || isPreselected(pallet)) checked.add(index);
    });

    const box = openPopup(`
        <h3>${escapeHtml(title)}</h3>
        <p class="hint">${escapeHtml(hint || 'Urut dari expired paling dekat (FEFO). Centang pallet yang dipilih.')}</p>
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th class="check-cell"><input type="checkbox" id="check-all" aria-label="Centang semua pallet"></th>
                        ${showItem ? '<th>Item Code</th><th>Description</th>' : ''}
                        <th>Exp Date</th><th class="num">Pallet</th><th>Supplier</th><th>Bin</th><th class="num">Qty</th><th>UoM</th>
                        <th class="num">Qty SAP</th><th>UoM SAP</th><th>Remark</th>
                    </tr>
                </thead>
                <tbody>
                    ${pallets.map((pallet, index) => `
                        <tr class="check-row" data-index="${index}">
                            <td class="check-cell">
                                <input type="checkbox" data-index="${index}"
                                       aria-label="Pallet ${escapeHtml(pallet.pallet_number)}, ${escapeHtml(pallet.item_code)}, exp ${escapeHtml(pallet.exp_date)}">
                            </td>
                            ${showItem ? `<td>${escapeHtml(pallet.item_code)}</td><td class="wrap">${escapeHtml(pallet.description)}</td>` : ''}
                            <td>${escapeHtml(pallet.exp_date)}</td>
                            <td class="num">${escapeHtml(pallet.pallet_number)}</td>
                            <td class="wrap">${escapeHtml(pallet.supplier)}</td>
                            <td>${escapeHtml(pallet.bin)}</td>
                            <td class="num">${formatNumber(pallet.qty_actual)}</td>
                            <td>${escapeHtml(pallet.uom_fisik)}</td>
                            <td class="num">${formatQtySap(pallet.qty_sap)}</td>
                            <td>${escapeHtml(pallet.uom_sap)}</td>
                            <td class="wrap">${escapeHtml(pallet.remark)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        <div class="popup-footer">
            <p class="check-summary" aria-live="polite"></p>
            <div class="form-actions">
                <button type="button" class="btn-add-checked btn-soft" data-icon="plus">Add</button>
                <button type="button" class="btn-close-popup" data-icon="x">Batal</button>
            </div>
        </div>
    `);

    const addButton = box.querySelector('.btn-add-checked');
    const checkAll = box.querySelector('#check-all');

    // Gambar ulang tanda centang, sorotan baris, dan total dari isi `checked`.
    const update = () => {
        box.querySelectorAll('.check-row').forEach(tr => {
            const on = checked.has(Number(tr.dataset.index));
            tr.classList.toggle('is-checked', on);
            tr.querySelector('input').checked = on;
        });
        checkAll.checked = checked.size === pallets.length;
        checkAll.indeterminate = checked.size > 0 && checked.size < pallets.length;

        const list = [...checked].map(index => pallets[index]);
        // textContent: UoM dari database aman tanpa escapeHtml. Total per UoM (isi satu bin bisa campur).
        box.querySelector('.check-summary').textContent = list.length === 0
            ? 'Belum ada pallet yang dicentang.'
            : `${list.length} pallet dicentang · Total ${sumByUnit(list, 'qty_actual', 'uom_fisik', formatNumber)}`
              + ` (${sumByUnit(list, 'qty_sap', 'uom_sap', formatQtySap)})`;
        addButton.disabled = list.length === 0;
        addButton.textContent = list.length > 0 ? `Add ${list.length} pallet` : 'Add';
    };

    // Centang lewat kotak centang (termasuk "centang semua" di kepala tabel).
    box.addEventListener('change', (e) => {
        if (e.target === checkAll) {
            checked.clear();
            if (checkAll.checked) pallets.forEach((_, index) => checked.add(index));
        } else if (e.target.dataset.index !== undefined) {
            const index = Number(e.target.dataset.index);
            e.target.checked ? checked.add(index) : checked.delete(index);
        }
        update();
    });

    // Klik di bagian lain baris juga mencentang / melepas (target sentuh lebih besar di HP).
    box.addEventListener('click', (e) => {
        const tr = e.target.closest('.check-row');
        if (!tr || e.target.matches('input')) return;

        const index = Number(tr.dataset.index);
        checked.has(index) ? checked.delete(index) : checked.add(index);
        update();
    });

    box.querySelector('.btn-close-popup').addEventListener('click', closePopup);
    addButton.addEventListener('click', () => {
        // Urut seperti di popup (FEFO), bukan urutan klik.
        const list = [...checked].sort((a, b) => a - b).map(index => pallets[index]);
        if (onAdd(list) !== false) closePopup();
    });

    update();
    (checked.size > 0 ? addButton : box.querySelector('.check-row input'))?.focus();
}
