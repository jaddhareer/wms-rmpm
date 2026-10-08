// Paginasi bernomor yang bisa dipakai halaman mana pun (Transaksi, nanti Stock Overview).
// Modul ini hanya MEMBUAT HTML. Klik tombolnya ditangani oleh halaman pemakai,
// lewat satu listener di wadahnya (event delegation) yang membaca data-page.

// Daftar nomor yang ditampilkan: halaman pertama, terakhir, dan `around` halaman
// di kiri-kanan halaman aktif. Lompatan diganti '…'.
// Contoh: pageNumbers(7, 13) -> [1, '…', 5, 6, 7, 8, 9, '…', 13]
export function pageNumbers(page, totalPages, around = 2){
    const numbers = new Set([1, totalPages]);

    for (let n = page - around; n <= page + around; n++) {
        if (n >= 1 && n <= totalPages) numbers.add(n);
    }

    const sorted = [...numbers].sort((a, b) => a - b);

    const result = [];
    sorted.forEach((n, i) => {
        if (i > 0 && n - sorted[i - 1] > 1) result.push('…');
        result.push(n);
    });

    return result;
}

// HTML tombol paginasi. Kosong kalau hanya ada satu halaman.
export function paginationHtml(page, totalPages){
    if (totalPages <= 1) return '';

    const buttons = pageNumbers(page, totalPages).map(n => {
        if (n === '…') return `<span class="page-gap">…</span>`;
        if (n === page) return `<button type="button" class="page-btn active" disabled aria-current="page">${n}</button>`;
        return `<button type="button" class="page-btn" data-page="${n}">${n}</button>`;
    });

    const prev = `<button type="button" class="page-btn" data-page="${page - 1}" data-icon="chevron-left" aria-label="Halaman sebelumnya" ${page <= 1 ? 'disabled' : ''}></button>`;
    const next = `<button type="button" class="page-btn" data-page="${page + 1}" data-icon="chevron-right" aria-label="Halaman berikutnya" ${page >= totalPages ? 'disabled' : ''}></button>`;

    return [prev, ...buttons, next].join(' ');
}