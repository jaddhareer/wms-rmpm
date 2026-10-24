import { setInputValue } from "./tools.js";
import { toast } from "./toast.js";
import { ITEM_CODE_PATTERN } from "./materialAutocomplete.js";

// Scan QR code dengan kamera untuk mengisi input (item code, bin).
//
// Library: html5-qrcode 2.3.8 (public/vendor/html5-qrcode.min.js, lisensi Apache-2.0).
// Di dalamnya ada ZXing, pembaca QR/barcode yang ditulis dalam JavaScript. Kalau browser punya
// pembaca bawaan (BarcodeDetector, ada di Chrome Android), library memakai itu dulu
// karena lebih cepat, dan ZXing jadi cadangan.
//
// Dua cara scan:
// 1. Kamera langsung (video di popup). Browser hanya memberi akses kamera ke halaman yang
//    "aman": HTTPS atau localhost. Dibuka lewat http://192.168.x.x -> kamera ditolak browser.
// 2. Foto. Kalau kamera langsung tidak bisa dipakai, tombol scan membuka aplikasi kamera HP
//    (<input type="file" capture>), lalu kode dibaca dari foto itu. Cara ini jalan juga di http.
//
// Pemakaian: taruh tombolnya di template halaman, di samping input, di dalam .input-group:
//     <div class="input-group">
//         <input type="text" id="item-code">
//         ${scanButtonHtml('item-code', 'item')}
//     </div>
// Klik tombol ditangani SATU listener untuk seluruh aplikasi (initScanButtons, dipanggil
// sekali dari main.js), jadi halaman tidak perlu memasang listener apa pun.
// Hasil scan masuk lewat setInputValue(): listener 'input' halaman jalan seperti diketik.

const LIBRARY_SRC = 'public/vendor/html5-qrcode.min.js';

// Panjang maksimal bin = kolom stock.bin VARCHAR(20).
const BIN_MAX_LENGTH = 20;

// Kamera yang terakhir dipilih operator, disimpan di browser HP itu sendiri (localStorage).
// Setiap HP punya susunan kamera berbeda, jadi pilihan ini memang milik perangkat, bukan user.
const CAMERA_STORAGE_KEY = 'wms-rmpm.scan-camera';

// Semua label di gudang memakai QR code, jadi hanya QR yang dibaca: lebih cepat dan tidak
// salah baca barcode lain di kemasan. Kalau nanti ada label barcode batang, tambahkan jenisnya
// di sini (nama: Html5QrcodeSupportedFormats, mis. 'CODE_128') dan lebarkan qrBox.
const FORMATS = ['QR_CODE'];

// Kotak bidik persegi (QR selalu persegi), 70% dari sisi video yang lebih pendek.
// Hanya bagian di dalam kotak ini yang dibaca.
function qrBox(width, height){
    const size = Math.floor(Math.min(width, height) * 0.7);
    return { width: size, height: size };
}

// Aturan per jenis input.
//   read  = rapikan teks hasil scan.
//   check = null kalau benar, atau alasan kenapa hasil scan ditolak (ditampilkan ke operator).
const KINDS = {
    item: {
        title: 'Scan Item Code',
        hint: 'Arahkan kamera ke QR item code.',
        read: (text) => text.trim(),
        check: (code) => ITEM_CODE_PATTERN.test(code) ? null : 'bukan item code (9 digit angka)',
    },
    bin: {
        title: 'Scan Bin',
        hint: 'Arahkan kamera ke QR bin di rak.',
        read: (text) => text.trim().toUpperCase(),
        check: (code) => {
            if (ITEM_CODE_PATTERN.test(code)) return 'ini item code, bukan bin';
            if (code === '' || code.length > BIN_MAX_LENGTH) return 'bukan kode bin';
            return null;
        },
    },
};

// Tombol kamera untuk input dengan id inputId. kind = 'item' | 'bin' (lihat KINDS).
export function scanButtonHtml(inputId, kind){
    const title = KINDS[kind].title;
    return `<button type="button" class="field-tool" data-scan="${kind}" data-target="${inputId}"
                    data-icon="scan" aria-label="${title}" title="${title} dengan kamera"></button>`;
}

// Dipanggil SEKALI dari main.js. Event delegation di document: tombol scan di halaman
// mana pun (digambar ulang setiap pindah halaman) tetap tertangkap listener yang sama.
export function initScanButtons(){
    document.addEventListener('click', (e) => {
        const button = e.target.closest('[data-scan]');
        if (!button) return;

        const input = document.getElementById(button.dataset.target);
        if (!input || input.disabled) return; // mis. bin Retur saat pallet masih berisi

        if (window.isSecureContext && navigator.mediaDevices?.getUserMedia) {
            scanWithCamera(input, KINDS[button.dataset.scan], button);
        } else {
            scanFromPhoto(input, KINDS[button.dataset.scan]); // http biasa: kamera langsung ditolak browser
        }
    });
}

// --- Library ---------------------------------------------------------------------------

let libraryPromise = null;

// Library (375 KB) baru diunduh saat pertama kali scan, bukan saat aplikasi dibuka:
// kebanyakan halaman tidak memakainya. Setelah itu tersimpan di cache browser.
function loadLibrary(){
    if (!libraryPromise) {
        libraryPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = LIBRARY_SRC;
            // Script biasa (bukan modul): isinya tersedia sebagai variabel global.
            script.onload = () => resolve(window.__Html5QrcodeLibrary__);
            script.onerror = () => {
                script.remove();
                libraryPromise = null; // boleh dicoba lagi pada scan berikutnya
                reject(new Error('library scanner gagal dimuat'));
            };
            document.head.appendChild(script);
        });
    }
    return libraryPromise;
}

function createReader(lib, elementId){
    return new lib.Html5Qrcode(elementId, {
        formatsToSupport: FORMATS.map(name => lib.Html5QrcodeSupportedFormats[name]),
        useBarCodeDetectorIfSupported: true,
        verbose: false,
    });
}

// --- Cara 1: kamera langsung -----------------------------------------------------------

// Popup video kamera. Overlay-nya sendiri (bukan openPopup), jadi popup lain tidak ikut tertutup.
async function scanWithCamera(input, kind, trigger){
    const overlay = document.createElement('div');
    overlay.className = 'scan-overlay';
    overlay.innerHTML = `
        <div class="scan-box" role="dialog" aria-modal="true" aria-labelledby="scan-title">
            <h3 id="scan-title" data-icon="scan"></h3>
            <div class="scan-view" id="scan-view"></div>
            <div class="field scan-camera" hidden>
                <label for="scan-camera">Kamera</label>
                <select id="scan-camera"></select>
            </div>
            <p class="scan-status" aria-live="polite"></p>
            <div class="scan-actions">
                <button type="button" class="scan-torch" data-icon="flash" aria-pressed="false" hidden>Senter</button>
                <button type="button" class="scan-photo" data-icon="camera" hidden>Pakai Foto</button>
                <button type="button" class="scan-cancel" data-icon="x">Batal</button>
            </div>
        </div>
    `;
    overlay.querySelector('#scan-title').textContent = kind.title;

    const statusEl = overlay.querySelector('.scan-status');
    const cameraField = overlay.querySelector('.scan-camera');
    const cameraSelect = overlay.querySelector('#scan-camera');
    const torchButton = overlay.querySelector('.scan-torch');
    const photoButton = overlay.querySelector('.scan-photo');

    // tone: '' (biasa) | 'warning' | 'error'. textContent: hasil scan bisa berisi apa saja.
    const setStatus = (text, tone = '') => {
        statusEl.textContent = text;
        statusEl.className = 'scan-status' + (tone ? ` is-${tone}` : '');
    };

    let reader = null;    // objek Html5Qrcode
    let starting = null;  // Promise start() kamera yang terakhir
    let closed = false;
    let torch = null;     // fitur senter kamera yang sedang menyala (null = tidak ada)
    let torchOn = false;

    // Nyalakan kamera. deviceId = kamera pilihan operator; null = kamera belakang bawaan browser
    // (di sebagian HP bawaan ini justru kamera ultrawide, makanya ada pilihan kamera).
    const startCamera = (deviceId) => {
        // Resolusi lebih tinggi dari bawaan (640x480): QR kecil lebih mudah terbaca.
        const resolution = { width: { ideal: 1280 }, height: { ideal: 720 } };
        starting = reader.start(
            deviceId ?? { facingMode: 'environment' },
            {
                fps: 10,
                qrbox: qrBox,
                videoConstraints: deviceId
                    ? { deviceId: { exact: deviceId }, ...resolution }
                    : { facingMode: 'environment', ...resolution },
            },
            onDecoded,
            () => {},     // frame tanpa QR: diam saja
        );
        return starting;
    };

    // Dipanggil setiap kamera selesai menyala (pertama kali & setelah ganti kamera).
    const onCameraReady = () => {
        setStatus(kind.hint);
        photoButton.hidden = true;

        // Senter dicek ulang per kamera: kamera ultrawide / depan biasanya tanpa lampu.
        torch = null;
        torchOn = false;
        try {
            const feature = reader.getRunningTrackCameraCapabilities().torchFeature();
            if (feature.isSupported()) torch = feature;
        } catch { /* kamera tidak memberi info senter */ }
        torchButton.hidden = !torch;
        torchButton.setAttribute('aria-pressed', 'false');
    };

    // Daftar kamera untuk dipilih. Nama & id kamera baru terbaca SETELAH izin kamera diberikan,
    // jadi dipanggil sesudah start(). Hanya tampil kalau kamera lebih dari satu.
    const fillCameraList = async () => {
        let cameras;
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            cameras = devices.filter(d => d.kind === 'videoinput' && d.deviceId);
        } catch {
            return;
        }
        if (closed || cameras.length < 2) return;

        // new Option() (bukan innerHTML): nama kamera dari perangkat masuk sebagai teks biasa.
        cameraSelect.replaceChildren(...cameras.map((camera, i) => new Option(camera.label || `Kamera ${i + 1}`, camera.deviceId)));
        try {
            cameraSelect.value = reader.getRunningTrackSettings().deviceId ?? '';
        } catch { /* kamera belum menyala: biarkan pilihan pertama */ }
        cameraField.hidden = false;
    };

    const close = async () => {
        if (closed) return;
        closed = true;
        overlay.remove();
        window.removeEventListener('popstate', close);
        trigger.focus(); // fokus kembali ke tombol scan

        // Kamera WAJIB dimatikan, kalau tidak lampu kamera HP tetap menyala.
        // Tunggu start() selesai dulu: kamera yang masih menyala tidak bisa dihentikan di tengah jalan.
        try { await starting; } catch { /* gagal start = kamera memang tidak menyala */ }
        try { await reader?.stop(); } catch { /* sudah berhenti */ }
    };

    const onDecoded = (text) => {
        if (closed) return;

        const code = kind.read(text);
        const problem = kind.check(code);
        if (problem) {
            // Kamera tetap jalan: operator cukup mengarahkan ke kode yang benar.
            setStatus(`Terbaca "${code}": ${problem}.`, 'warning');
            return;
        }

        navigator.vibrate?.(80); // getar singkat = tanda berhasil (HP Android)
        close();
        setInputValue(input, code);
    };

    overlay.querySelector('.scan-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(); // klik area gelap di luar kotak
    });
    overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
    });
    // Tombol back HP saat popup terbuka: halaman berganti, kamera harus ikut mati.
    window.addEventListener('popstate', close);

    photoButton.addEventListener('click', () => {
        close();
        scanFromPhoto(input, kind);
    });

    // Ganti kamera: matikan yang lama, nyalakan yang dipilih, dan ingat pilihannya untuk scan berikutnya.
    cameraSelect.addEventListener('change', async () => {
        const deviceId = cameraSelect.value;
        saveCamera(deviceId);
        cameraSelect.disabled = true;
        torchButton.hidden = true;
        setStatus('Mengganti kamera...');

        try {
            try { await reader.stop(); } catch { /* kamera lama memang tidak menyala */ }
            if (closed) return;
            await startCamera(deviceId);
            if (!closed) onCameraReady();
        } catch (err) {
            if (!closed) setStatus(cameraErrorText(err), 'error');
        } finally {
            cameraSelect.disabled = false;
        }
    });

    // Senter (lampu flash) untuk rak yang gelap. Tombolnya hanya muncul kalau kamera mendukung.
    torchButton.addEventListener('click', async () => {
        if (!torch) return;
        try {
            await torch.apply(!torchOn);
            torchOn = !torchOn;
            torchButton.setAttribute('aria-pressed', String(torchOn));
        } catch {
            toast('Senter tidak bisa dinyalakan', 'warning');
        }
    });

    document.body.appendChild(overlay);
    overlay.querySelector('.scan-cancel').focus();
    setStatus('Menyiapkan kamera...');

    try {
        const lib = await loadLibrary();
        if (closed) return;

        reader = createReader(lib, 'scan-view');
        const saved = savedCamera();
        try {
            await startCamera(saved);
        } catch (err) {
            // Kamera yang tersimpan sudah tidak ada / tidak bisa dibuka: pakai kamera belakang bawaan.
            if (!saved || closed) throw err;
            await startCamera(null);
        }
        if (closed) return;

        onCameraReady();
    } catch (err) {
        if (closed) return;
        setStatus(cameraErrorText(err), 'error');
        photoButton.hidden = false;
        photoButton.focus();
    }

    // Juga setelah gagal: kalau izin sudah ada, operator bisa mencoba kamera lain dari daftar.
    if (reader) await fillCameraList();
}

function savedCamera(){
    try {
        return localStorage.getItem(CAMERA_STORAGE_KEY) || null;
    } catch {
        return null; // penyimpanan browser diblokir: pakai kamera bawaan
    }
}

function saveCamera(deviceId){
    try {
        localStorage.setItem(CAMERA_STORAGE_KEY, deviceId);
    } catch { /* penyimpanan browser diblokir: pilihan berlaku untuk scan ini saja */ }
}

// Error dari library berbentuk teks, mis. "Error getting userMedia, error = NotAllowedError: ...".
function cameraErrorText(err){
    const text = String(err?.message ?? err);

    if (text.includes('NotAllowedError')) {
        return 'Akses kamera ditolak. Izinkan kamera untuk situs ini di pengaturan browser, atau pakai foto.';
    }
    if (text.includes('NotFoundError') || text.includes('OverconstrainedError')) {
        return 'Kamera tidak ditemukan di perangkat ini. Pakai foto sebagai gantinya.';
    }
    if (text.includes('NotReadableError')) {
        return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.';
    }
    return 'Kamera tidak bisa dibuka: ' + text;
}

// --- Cara 2: foto ----------------------------------------------------------------------

let photoInput = null;   // <input type="file"> tersembunyi, dibuat sekali lalu dipakai ulang
let photoTarget = null;  // { input, kind } yang menunggu hasil foto

// Harus dipanggil langsung dari klik operator (tanpa await sebelumnya): browser hanya mau
// membuka pemilih file / kamera kalau dipicu klik.
function scanFromPhoto(input, kind){
    if (!photoInput) {
        photoInput = document.createElement('input');
        photoInput.type = 'file';
        photoInput.accept = 'image/*';
        photoInput.setAttribute('capture', 'environment'); // HP: langsung buka kamera belakang
        photoInput.hidden = true;
        photoInput.addEventListener('change', handlePhoto);
        document.body.appendChild(photoInput);
    }

    photoTarget = { input, kind };
    photoInput.value = ''; // foto dengan nama sama tetap memicu 'change'
    photoInput.click();
}

async function handlePhoto(){
    const file = photoInput.files[0];
    const { input, kind } = photoTarget ?? {};
    if (!file || !input) return;

    let text;
    try {
        const lib = await loadLibrary();

        // Library butuh elemen di halaman walaupun fotonya tidak ditampilkan.
        let holder = document.getElementById('scan-photo-holder');
        if (!holder) {
            holder = document.createElement('div');
            holder.id = 'scan-photo-holder';
            holder.hidden = true;
            document.body.appendChild(holder);
        }

        const reader = createReader(lib, holder.id);
        text = await reader.scanFile(file, false);
        reader.clear();
    } catch {
        toast('Kode tidak terbaca dari foto. Foto lebih dekat dan terang, kode harus utuh di foto.', 'warning');
        return;
    }

    // Selama memotret, operator bisa sudah pindah halaman (input lama sudah tidak ada).
    if (!input.isConnected || input.disabled) return;

    const code = kind.read(text);
    const problem = kind.check(code);
    if (problem) {
        toast(`Terbaca "${code}": ${problem}`, 'warning');
        return;
    }

    setInputValue(input, code);
}
