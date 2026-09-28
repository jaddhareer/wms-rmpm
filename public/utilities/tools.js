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