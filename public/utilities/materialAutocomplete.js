import { escapeHtml } from "./tools.js";
import { autocomplete } from "./autocomplete.js";

// Autocomplete khusus input item code. Dipakai Inbound, Outbound, dan Bin to Bin
// supaya cara mencari material di semua halaman seragam.
//
// Alur: ketik deskripsi -> saran dari material master -> dipilih
//       -> isi input DIGANTI item code -> onSelect(material) dari halaman.

const MATERIAL_API = 'controller/MaterialController.php';

// Item code selalu 9 digit angka. Pola ini membedakan "scan / ketik item code penuh"
// (dicari persis oleh halaman) dari "ketik deskripsi" (pakai saran).
// Jangan pakai length === 9: deskripsi 9 huruf (mis. "quadriple") ikut terpicu.
export const ITEM_CODE_PATTERN = /^\d{9}$/;

// inStockOnly: true = hanya material yang masih punya stok (Outbound, Bin to Bin).
export function materialAutocomplete(input, { onSelect, inStockOnly = false }){
    input.placeholder = 'scan item code / ketik deskripsi';

    autocomplete(input, {
        search: async (term) => {
            // Item code penuh sudah dicari persis oleh halaman, tidak perlu saran.
            if (ITEM_CODE_PATTERN.test(term)) return null;

            const params = new URLSearchParams({ q: term });
            if (inStockOnly) params.set('in_stock', '1');

            const res = await fetch(`${MATERIAL_API}?${params}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            return data.data;
        },

        renderItem: (m) => `${escapeHtml(m.item_name)} <small style="color:#666">${escapeHtml(m.item_code)}</small>`,

        onSelect: (m) => {
            // Mengisi value lewat kode TIDAK memicu event 'input', jadi pencarian
            // persis milik halaman tidak jalan dua kali. Halaman lanjut lewat onSelect.
            input.value = m.item_code;
            onSelect(m);
        },
    });
}
