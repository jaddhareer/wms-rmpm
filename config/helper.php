<!-- file untuk function-function yang diperlukan untuk membantu aplikasi seperti generate transaction ID -->
<?php

function sanitize(string $val): string {
    return trim(htmlspecialchars($val, ENT_QUOTES, 'UTF-8'));
}