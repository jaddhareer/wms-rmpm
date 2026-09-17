<!-- ini file  untuk bootstrapping -->
<!-- require once semua file yang perlu dipanggil untuk nantinya file ini di panggil di file lain -->
<?php

require_once __DIR__ . '/database.php';
require_once __DIR__ . '/helper.php';

require_once dirname(__DIR__) . '/model/Stock.php';