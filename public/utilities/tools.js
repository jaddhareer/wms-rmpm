import { apiFetch } from "./auth.js";

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
// Saran bin yang muncul di semua input bin (lewat <datalist>).
// Ubah di SATU tempat ini kalau penulisan bin floor di lapangan berbeda.
export const BIN_SUGGESTIONS = ['FLOOR 40', 'FLOOR 50', 'STAGE'];

// <datalist> berisi BIN_SUGGESTIONS. Pasangkan dengan <input list="bin-options">.
// Datalist hanya memberi saran: operator tetap bisa mengetik bin rak seperti A-01-B-02.
export function binDatalistHtml(){
    return `<datalist id="bin-options">${BIN_SUGGESTIONS.map(b => `<option value="${escapeHtml(b)}">`).join('')}</datalist>`;
}

// Download file (mis. Excel) dari controller TANPA meninggalkan halaman SPA.
// fetch -> Blob (data biner di memori browser) -> link sementara -> klik otomatis.
// Kalau server membalas JSON, berarti terjadi error: pesannya dilempar sebagai Error.
export async function downloadFile(url, fallbackName = 'export.xlsx'){
    const res = await apiFetch(url);
    const type = res.headers.get('Content-Type') || '';

    if (!res.ok || type.includes('application/json')) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = match ? match[1] : fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();

    // Lepaskan memori Blob sedikit setelah download dimulai.
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}