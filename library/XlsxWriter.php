<?php

// =========================================================
// XlsxWriter: membuat file Excel (.xlsx) asli TANPA library/Composer.
//
// File .xlsx sebenarnya adalah file ZIP berisi beberapa file XML.
// Class ini menyusun XML-nya, lalu membungkusnya jadi ZIP sendiri,
// jadi tidak butuh PhpSpreadsheet maupun ekstensi zip.
//
// Kenapa bukan CSV? Excel dengan setelan Indonesia membaca "35.500"
// di CSV sebagai tiga puluh lima ribu lima ratus. Di .xlsx, angka
// disimpan sebagai angka, jadi aman di setelan bahasa apa pun.
//
// Cara pakai:
//   $xlsx = new XlsxWriter('Stock');
//   $xlsx->setHeaders(['Item Code', 'Qty']);
//   $xlsx->addRow(['400010303', 10.5]);   // string -> teks, int/float -> angka
//   $xlsx->download('stock.xlsx');
// =========================================================

class XlsxWriter {
    private $sheetName;
    private $headers = [];
    private $rows = [];
    private $columnWidths = [];

    public function __construct(string $sheetName = 'Sheet1') {
        // Nama sheet Excel maks 31 karakter dan tidak boleh berisi : \ / ? * [ ]
        $this->sheetName = mb_substr(preg_replace('/[:\\\\\/?*\[\]]/', '', $sheetName), 0, 31) ?: 'Sheet1';
    }

    public function setHeaders(array $headers): void {
        $this->headers = array_values($headers);
        $this->trackWidths($this->headers);
    }

    // Tipe nilai menentukan tipe sel: int/float jadi angka, selain itu teks.
    // Jadi item code '400010303' (string) tetap teks dan tidak berubah jadi 4,00E+08.
    public function addRow(array $row): void {
        $row = array_values($row);
        $this->rows[] = $row;
        $this->trackWidths($row);
    }

    // Kirim file ke browser sebagai download, lalu hentikan script.
    public function download(string $filename): void {
        $content = $this->build();

        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="' . str_replace('"', '', $filename) . '"');
        header('Content-Length: ' . strlen($content));
        header('Cache-Control: no-store');

        echo $content;
        exit;
    }

    // Isi file .xlsx sebagai string biner (dipakai download(), juga berguna untuk tes).
    public function build(): string {
        return $this->zip([
            '[Content_Types].xml'        => $this->contentTypesXml(),
            '_rels/.rels'                => $this->rootRelsXml(),
            'xl/workbook.xml'            => $this->workbookXml(),
            'xl/_rels/workbook.xml.rels' => $this->workbookRelsXml(),
            'xl/styles.xml'              => $this->stylesXml(),
            'xl/worksheets/sheet1.xml'   => $this->sheetXml(),
        ]);
    }

    // ---------------------------------------------------------
    // Isi sheet
    // ---------------------------------------------------------

    private function sheetXml(): string {
        $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';

        // Baris judul dibekukan: tetap terlihat saat di-scroll ke bawah.
        if ($this->headers) {
            $xml .= '<sheetViews><sheetView workbookViewId="0">'
                  . '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
                  . '</sheetView></sheetViews>';
        }

        // Lebar kolom kira-kira mengikuti isi terpanjang (dibatasi 60).
        if ($this->columnWidths) {
            $xml .= '<cols>';
            foreach ($this->columnWidths as $i => $len) {
                $width = min(60, max(8, $len + 2));
                $n = $i + 1;
                $xml .= "<col min=\"$n\" max=\"$n\" width=\"$width\" customWidth=\"1\"/>";
            }
            $xml .= '</cols>';
        }

        $xml .= '<sheetData>';
        $rowNumber = 1;

        if ($this->headers) {
            $xml .= $this->rowXml($this->headers, $rowNumber++, true);
        }
        foreach ($this->rows as $row) {
            $xml .= $this->rowXml($row, $rowNumber++, false);
        }

        return $xml . '</sheetData></worksheet>';
    }

    private function rowXml(array $values, int $rowNumber, bool $isHeader): string {
        $xml = "<row r=\"$rowNumber\">";

        foreach ($values as $i => $value) {
            $ref = self::columnLetter($i) . $rowNumber;
            $style = $isHeader ? ' s="1"' : '';   // style 1 = tebal (lihat stylesXml)

            if ($value === null || $value === '') {
                continue; // sel kosong cukup tidak ditulis
            }

            if (!$isHeader && (is_int($value) || is_float($value))) {
                $xml .= "<c r=\"$ref\"$style><v>" . self::numberText($value) . '</v></c>';
            } else {
                $xml .= "<c r=\"$ref\" t=\"inlineStr\"$style><is><t xml:space=\"preserve\">"
                      . self::xmlText((string) $value) . '</t></is></c>';
            }
        }

        return $xml . '</row>';
    }

    // 0 -> A, 25 -> Z, 26 -> AA, ...
    private static function columnLetter(int $index): string {
        $letters = '';
        $index++;
        while ($index > 0) {
            $mod = ($index - 1) % 26;
            $letters = chr(65 + $mod) . $letters;
            $index = intdiv($index - 1, 26);
        }
        return $letters;
    }

    // Angka selalu ditulis dengan titik desimal (format XML), apa pun setelan server.
    private static function numberText($value): string {
        if (is_int($value)) {
            return (string) $value;
        }
        return rtrim(rtrim(sprintf('%.6F', $value), '0'), '.') ?: '0';
    }

    // Escape karakter khusus XML dan buang karakter kontrol yang tidak boleh ada di XML.
    private static function xmlText(string $text): string {
        $text = preg_replace('/[^\x{9}\x{A}\x{D}\x{20}-\x{D7FF}\x{E000}-\x{FFFD}]/u', '', $text) ?? '';
        return htmlspecialchars($text, ENT_QUOTES | ENT_XML1, 'UTF-8');
    }

    private function trackWidths(array $values): void {
        foreach (array_values($values) as $i => $value) {
            $len = mb_strlen(is_float($value) ? self::numberText($value) : (string) $value);
            $this->columnWidths[$i] = max($this->columnWidths[$i] ?? 0, $len);
        }
    }

    // ---------------------------------------------------------
    // File XML pendukung (isinya selalu sama)
    // ---------------------------------------------------------

    private function contentTypesXml(): string {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             . '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
             . '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
             . '<Default Extension="xml" ContentType="application/xml"/>'
             . '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
             . '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
             . '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
             . '</Types>';
    }

    private function rootRelsXml(): string {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
             . '</Relationships>';
    }

    private function workbookXml(): string {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             . '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
             . 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
             . '<sheets><sheet name="' . self::xmlText($this->sheetName) . '" sheetId="1" r:id="rId1"/></sheets>'
             . '</workbook>';
    }

    private function workbookRelsXml(): string {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             . '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             . '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
             . '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
             . '</Relationships>';
    }

    // Style 0 = normal, style 1 = tebal (untuk baris judul).
    private function stylesXml(): string {
        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             . '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
             . '<fonts count="2">'
             .   '<font><sz val="11"/><name val="Calibri"/></font>'
             .   '<font><b/><sz val="11"/><name val="Calibri"/></font>'
             . '</fonts>'
             . '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
             . '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
             . '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
             . '<cellXfs count="2">'
             .   '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
             .   '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
             . '</cellXfs>'
             . '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
             . '</styleSheet>';
    }

    // ---------------------------------------------------------
    // Pembungkus ZIP sederhana (format ZIP standar, tanpa ekstensi zip PHP)
    // ---------------------------------------------------------

    private function zip(array $files): string {
        $now = getdate();
        $dosTime = ($now['hours'] << 11) | ($now['minutes'] << 5) | intdiv($now['seconds'], 2);
        $dosDate = (($now['year'] - 1980) << 9) | ($now['mon'] << 5) | $now['mday'];

        $body = '';
        $centralDirectory = '';

        foreach ($files as $name => $data) {
            $crc = crc32($data);
            $size = strlen($data);

            // Kompres kalau zlib tersedia (bawaan PHP di Windows), kalau tidak simpan apa adanya.
            $compressed = function_exists('gzdeflate') ? gzdeflate($data, 6) : false;
            $method = $compressed !== false ? 8 : 0;
            $stored = $compressed !== false ? $compressed : $data;

            $offset = strlen($body);

            $body .= pack('VvvvvvVVVvv', 0x04034b50, 20, 0, $method, $dosTime, $dosDate,
                          $crc, strlen($stored), $size, strlen($name), 0)
                   . $name . $stored;

            $centralDirectory .= pack('VvvvvvvVVVvvvvvVV', 0x02014b50, 20, 20, 0, $method, $dosTime, $dosDate,
                                      $crc, strlen($stored), $size, strlen($name), 0, 0, 0, 0, 0, $offset)
                               . $name;
        }

        $end = pack('VvvvvVVv', 0x06054b50, 0, 0, count($files), count($files),
                    strlen($centralDirectory), strlen($body), 0);

        return $body . $centralDirectory . $end;
    }
}
