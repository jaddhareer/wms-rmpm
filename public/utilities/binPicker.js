import { escapeHtml, setInputValue, BIN_SUGGESTIONS } from "./tools.js";
import { openPopup, closePopup } from "./popups.js";
import { toast } from "./toast.js";
import { scanButtonHtml } from "./scanner.js";

// Popup Pilih Bin: operator memilih Baris, Nomor, Level, Posisi, lalu digabung jadi
// bin rak "A-01-A-01" (nomor selalu 2 digit). Tidak perlu mengetik tanda "-" di HP.
// Lokasi tanpa rak (FLOOR 40, FLOOR 50, STAGE) cukup satu klik di bagian bawah popup.
//
// Pemakaian di template halaman (tombol Pilih Bin + tombol scan kamera):
//     <div class="input-group">
//         <input type="text" id="bin">
//         ${binButtonsHtml('bin')}
//     </div>
// Klik tombol ditangani initBinPickerButtons (dipanggil sekali dari main.js).

// Susunan rak. Ubah di sini kalau rak gudang berubah.
// Baris A-D = Gudang 40, E-F = Gudang 50 (sama dengan Dashboard::LOCATIONS).
const ROWS = ['A', 'B', 'C', 'D', 'E', 'F'];
const NUMBER_MAX = 17;
const LEVELS = ['A', 'B', 'C'];
const POSITION_MAX = 3;

// Bin rak yang sudah ada di input, untuk isi awal popup. Mis. "B-05-C-02".
const RACK_BIN_PATTERN = /^([A-Z])-(\d{2})-([A-Z])-(\d{2})$/;

// Tombol Pilih Bin + tombol scan untuk input bin dengan id inputId.
export function binButtonsHtml(inputId){
    return `<button type="button" class="field-tool" data-bin-picker data-target="${inputId}"
                    data-icon="map-pin" aria-label="Pilih bin" title="Pilih bin"></button>`
        + scanButtonHtml(inputId, 'bin');
}

// Dipanggil SEKALI dari main.js (event delegation, sama seperti initScanButtons).
export function initBinPickerButtons(){
    document.addEventListener('click', (e) => {
        const button = e.target.closest('[data-bin-picker]');
        if (!button) return;

        const input = document.getElementById(button.dataset.target);
        if (!input || input.disabled) return;

        openBinPicker(input, button);
    });
}

function pad(n){
    return String(n).padStart(2, '0');
}

function optionsHtml(values, selected){
    return values.map(v => `<option value="${v}"${v === selected ? ' selected' : ''}>${v}</option>`).join('');
}

// Isi awal popup: bin rak yang sudah ada di input, kalau tidak ada -> A-01-A-01.
function initialParts(value){
    const m = value.trim().toUpperCase().match(RACK_BIN_PATTERN);
    if (m && ROWS.includes(m[1]) && LEVELS.includes(m[3])) {
        return { row: m[1], number: Number(m[2]), level: m[3], position: Number(m[4]) };
    }
    return { row: ROWS[0], number: 1, level: LEVELS[0], position: 1 };
}

function openBinPicker(input, trigger){
    const start = initialParts(input.value);

    const box = openPopup(`
        <h3>Pilih Bin</h3>
        <div class="form-stack">
            <div class="bin-picker">
                <div class="field">
                    <label for="bin-pick-row">Baris (${ROWS[0]}-${ROWS.at(-1)})</label>
                    <select id="bin-pick-row">${optionsHtml(ROWS, start.row)}</select>
                </div>
                <div class="field">
                    <label for="bin-pick-number">Nomor (01-${pad(NUMBER_MAX)})</label>
                    <input type="number" id="bin-pick-number" min="1" max="${NUMBER_MAX}" step="1" inputmode="numeric" value="${start.number}">
                </div>
                <div class="field">
                    <label for="bin-pick-level">Level (${LEVELS[0]}-${LEVELS.at(-1)})</label>
                    <select id="bin-pick-level">${optionsHtml(LEVELS, start.level)}</select>
                </div>
                <div class="field">
                    <label for="bin-pick-position">Posisi (01-${pad(POSITION_MAX)})</label>
                    <input type="number" id="bin-pick-position" min="1" max="${POSITION_MAX}" step="1" inputmode="numeric" value="${start.position}">
                </div>
            </div>
            <p class="bin-pick-result">Bin: <b id="bin-pick-result"></b></p>
            <div class="field">
                <span class="field-label">Lokasi tanpa rak</span>
                <div class="bin-pick-quick">
                    ${BIN_SUGGESTIONS.map(bin => `<button type="button" class="btn-sm" data-bin="${escapeHtml(bin)}">${escapeHtml(bin)}</button>`).join('')}
                </div>
            </div>
            <div class="form-actions">
                <button type="button" id="bin-pick-cancel" data-icon="x">Batal</button>
                <button type="button" id="bin-pick-apply" class="btn-primary" data-icon="check">Terapkan</button>
            </div>
        </div>
    `);

    const field = (name) => box.querySelector(`#bin-pick-${name}`);

    // Nomor & posisi diketik bebas, jadi dicek dulu: bilangan bulat dalam batasnya.
    // Mengembalikan teks bin, atau null kalau belum benar.
    const readBin = () => {
        const number = Number(field('number').value);
        const position = Number(field('position').value);
        if (!Number.isInteger(number) || number < 1 || number > NUMBER_MAX) return null;
        if (!Number.isInteger(position) || position < 1 || position > POSITION_MAX) return null;

        return `${field('row').value}-${pad(number)}-${field('level').value}-${pad(position)}`;
    };

    const renderResult = () => {
        field('result').textContent = readBin() ?? '-';
    };

    // Tutup popup DULU, baru isi input: listener input halaman bisa membuka popup lain
    // (Bin to Bin: pilih pallet), dan openPopup() selalu menutup popup yang sedang terbuka.
    const apply = (bin) => {
        closePopup();
        trigger.focus();
        setInputValue(input, bin);
    };

    const applyRackBin = () => {
        const bin = readBin();
        if (bin) {
            apply(bin);
            return;
        }

        const number = Number(field('number').value);
        const wrongNumber = !Number.isInteger(number) || number < 1 || number > NUMBER_MAX;
        toast(wrongNumber ? `Nomor harus 1-${NUMBER_MAX}` : `Posisi harus 1-${POSITION_MAX}`, 'warning');
        field(wrongNumber ? 'number' : 'position').focus();
    };

    box.addEventListener('input', renderResult);
    box.addEventListener('change', renderResult);

    box.addEventListener('click', (e) => {
        const quick = e.target.closest('[data-bin]');
        if (quick) apply(quick.dataset.bin);
    });

    box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.matches('input, select')) {
            e.preventDefault();
            applyRackBin();
        } else if (e.key === 'Escape') {
            closePopup();
            trigger.focus();
        }
    });

    field('apply').addEventListener('click', applyRackBin);
    field('cancel').addEventListener('click', () => {
        closePopup();
        trigger.focus();
    });

    renderResult();
    field('row').focus();
}
