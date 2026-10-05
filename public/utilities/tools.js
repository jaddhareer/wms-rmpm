// Fungsi-fungsi kecil yang dipakai banyak halaman.

export function setContent(html){
    const content = document.getElementById('content-area');
    content.innerHTML = html;
}

export function q(selector){
    return document.querySelector(selector);
}

export function qAll(selector){
    return document.querySelectorAll(selector);
}

// Wajib dipakai setiap kali menaruh data (dari user atau database) ke dalam innerHTML.
// Tanpa ini, remark berisi "<b>" akan dirender sebagai HTML, bukan teks.
export function escapeHtml(value){
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}
// Debounce: tunda pemanggilan fn sampai tidak ada panggilan baru selama `delay` ms.
// Dipakai untuk filter yang jalan saat diketik: mengetik "SODIUM" cukup 1 request, bukan 6.
export function debounce(fn, delay = 300){
    let timer = null;

    return (...args) => {
        clearTimeout(timer);                            // batalkan jadwal sebelumnya
        timer = setTimeout(() => fn(...args), delay);   // jadwalkan ulang dari awal
    };
}

// Angka dari database ("1000.000") -> "1.000" (format Indonesia, maks 3 desimal).
export function formatNumber(value){
    const n = parseFloat(value);
    return Number.isFinite(n) ? n.toLocaleString('id-ID', { maximumFractionDigits: 3 }) : '';
}