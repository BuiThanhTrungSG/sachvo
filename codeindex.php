<?php
require __DIR__ . '/helpers.php';

$method = $_SERVER['REQUEST_METHOD'];
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$base = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME']));
$path = '/' . trim(substr($uri, strlen($base)), '/');
$parts = array_values(array_filter(explode('/', $path)));

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
if($method === 'OPTIONS') exit;

try {
    $pdo = get_pdo();

    if(count($parts)===0 || $parts[0]===''){
        echo '<h1>API root - SachVo</h1>'; exit;
    }

    // ---------------- PUBLIC PRODUCTS ----------------
    if($parts[0]==='products'){
        $page   = max(1,intval($_GET['page'] ?? 1));
        $limit  = max(1,intval($_GET['limit'] ?? 10));
        $offset = ($page - 1) * $limit;
        $q = $_GET['q'] ?? '';

        // GET list with pagination and search
        if($method==='GET' && count($parts)===1){
            // tổng số
            if($q!==''){
                $countSql = 'SELECT COUNT(*) FROM products WHERE name LIKE :q';
                $countStmt = $pdo->prepare($countSql);
                $countStmt->bindValue(':q', "%$q%", PDO::PARAM_STR);
                $countStmt->execute();
                $total = (int)$countStmt->fetchColumn();
            } else {
                $total = (int)$pdo->query('SELECT COUNT(*) FROM products')->fetchColumn();
            }

            // danh sách
            $sql = '
                SELECT p.id, p.name, pi.image_path AS primary_thumbnail
                FROM products p
                LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = 1
            ';
            $params = [];
            if($q!==''){
                $sql .= ' WHERE p.name LIKE :q';
                $params[':q'] = "%$q%";
            }
            $sql .= " ORDER BY p.id DESC LIMIT $limit OFFSET $offset";

            $stmt = $pdo->prepare($sql);
            if(isset($params[':q'])) $stmt->bindValue(':q', $params[':q'], PDO::PARAM_STR);
            $stmt->execute();
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

            json_response([
                'page'=>$page,
                'limit'=>$limit,
                'total'=>$total,
                'total_pages'=>ceil($total/$limit),
                'data'=>$rows
            ]);
        }

        // GET single product (full info)
        if($method==='GET' && count($parts)===2){
            $id = intval($parts[1]);

            $stmt = $pdo->prepare('
                SELECT p.*, c.name AS category
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                WHERE p.id=?
            ');
            $stmt->execute([$id]);
            $product = $stmt->fetch(PDO::FETCH_ASSOC);
            if(!$product) json_response(['error'=>'Not found'],404);

            $stmt = $pdo->prepare('
                SELECT image_path,is_primary 
                FROM product_images 
                WHERE product_id=? 
                ORDER BY is_primary DESC,id ASC
            ');
            $stmt->execute([$id]);
            $product['images'] = $stmt->fetchAll(PDO::FETCH_ASSOC);

            // parse files_json nếu có
            if(isset($product['files_json']) && $product['files_json']){
                $product['files'] = json_decode($product['files_json'], true);
            }

            json_response($product);
        }
    }

    // ---------------- ORDERS ----------------
    if($parts[0]==='orders'){
        if($method==='POST' && count($parts)===1){
            $inp = json_decode(file_get_contents('php://input'), true);
            $productId = intval($inp['productId'] ?? 0);
            if(!$productId) json_response(['error'=>'productId required'],400);

            $stmt = $pdo->prepare('INSERT INTO orders_table(product_id,status,created_at) VALUES (?, "waiting", NOW())');
            $stmt->execute([$productId]);
            $orderId = $pdo->lastInsertId();

            $cfg = get_config();
            $qrImage = $cfg['base_url'] . '/api/mock-qrs/qr_'.$orderId.'.png';
            json_response(['orderId'=>$orderId,'qrImage'=>$qrImage]);
        }

        if($method==='GET' && count($parts)===2 && $parts[1]!=='status'){
            $orderId = intval($parts[1]);
            $stmt = $pdo->prepare('SELECT * FROM orders_table WHERE id=?');
            $stmt->execute([$orderId]);
            $o = $stmt->fetch(PDO::FETCH_ASSOC);
            if(!$o) json_response(['error'=>'Not found'],404);
            json_response($o);
        }

        if($method==='GET' && count($parts)===3 && $parts[2]==='status'){
            $orderId = intval($parts[1]);
            $stmt = $pdo->prepare('SELECT status FROM orders_table WHERE id=?');
            $stmt->execute([$orderId]);
            $o = $stmt->fetch(PDO::FETCH_ASSOC);
            if(!$o) json_response(['error'=>'Not found'],404);
            json_response(['status'=>$o['status']]);
        }
    }
// ---------------- PAYMENTS ----------------
if ($parts[0] === 'payments') {
    // Tạo payment request
    if ($method === 'POST' && count($parts) === 1) {
        $inp = json_decode(file_get_contents('php://input'), true);
        $orderCode   = $inp['orderCode']   ?? null;
        $productId   = intval($inp['productId'] ?? 0);
        $amount      = intval($inp['amount'] ?? 0);
        $description = $inp['description'] ?? "Thanh toán đơn hàng";

        if (!$orderCode || !$productId || !$amount) {
            json_response(['error' => 'orderCode, productId & amount required'], 400);
        }

        $payload = [
            "orderCode"   => $orderCode,
            "amount"      => $amount,
            "productId" => $productId,
            "description" => $description,
            "cancelUrl"   => "http://localhost/cancel.html", // TODO: chỉnh theo app của bạn
            "returnUrl"   => "http://localhost/success.html", // TODO: chỉnh theo app của bạn
        ];

        $ch = curl_init("https://api-merchant.payos.vn/v2/payment-requests");
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            "Content-Type: application/json",
            "x-client-id: 52e6ce27-71f3-4935-8d8b-bca19278fbb9",
            "x-api-key: e0803f7e-9a4e-4557-983d-bcda7ba7a9f6",
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($response === false) {
            json_response(['error' => curl_error($ch)], 500);
        }
        curl_close($ch);

        http_response_code($httpCode);
        echo $response;
        exit;
    }

    // Kiểm tra trạng thái payment
    if ($method === 'GET' && count($parts) === 3 && $parts[2] === 'status') {
        $id = $parts[1]; // paymentLinkId hoặc orderCode

        $ch = curl_init("https://api-merchant.payos.vn/v2/payment-requests/" . urlencode($id));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            "Content-Type: application/json",
            "x-client-id: 52e6ce27-71f3-4935-8d8b-bca19278fbb9",
            "x-api-key: e0803f7e-9a4e-4557-983d-bcda7ba7a9f6",
        ]);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($response === false) {
            json_response(['error' => curl_error($ch)], 500);
        }
        curl_close($ch);

        http_response_code($httpCode);
        echo $response;
        exit;
    }
}


    // ---------------- ADMIN ----------------
    if ($parts[0] === 'admin') {
        if ($parts[1] === 'login' && $method === 'POST') {
        $inp = json_decode(file_get_contents('php://input'), true);
        $u = $inp['username'] ?? '';
        $p = $inp['password'] ?? '';
        $stmt = $pdo->prepare('SELECT id,username,password_hash FROM admin_users WHERE username=?');
        $stmt->execute([$u]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row || !password_verify($p, $row['password_hash'])) {
            json_response(['error' => 'Invalid credentials'], 401);
        }
        $cfg = get_config();
        $token = jwt_encode(
            ['sub' => $row['id'], 'username' => $row['username'], 'role' => 'admin'],
            $cfg['jwt_secret'],
            3600 * 6
        );
        json_response(['token' => $token]);
        }

        if ($parts[0] === 'admin' && $parts[1] === 'products') {
            $admin = require_admin();

    // GET list with pagination
            if ($method === 'GET' && count($parts) === 2) {
                $page = max(1, intval($_GET['page'] ?? 1));
                $limit = max(1, intval($_GET['limit'] ?? 10));
                $offset = ($page - 1) * $limit;

                $total = (int)$pdo->query('SELECT COUNT(*) FROM products')->fetchColumn();

                $sql = "
                    SELECT p.*, c.name AS category
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    ORDER BY p.id DESC
                    LIMIT $limit OFFSET $offset
                ";
                $rows = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);

                // gắn thêm ảnh cho mỗi sản phẩm
                foreach ($rows as &$row) {
                    $stmt = $pdo->prepare("SELECT id,image_path,is_primary FROM product_images WHERE product_id=? ORDER BY is_primary DESC,id ASC");
                    $stmt->execute([$row['id']]);
                    $row['images'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
                    $row['primary_thumbnail'] = $row['images'][0]['image_path'] ?? null;
                }

                json_response([
                    'page' => $page,
                    'limit' => $limit,
                    'total' => $total,
                    'total_pages' => ceil($total / $limit),
                    'data' => $rows
                ]);
            }

            // POST - thêm mới sản phẩm
            // POST - thêm mới sản phẩm
            if ($method === 'POST' && count($parts) === 2) {
                $name = $_POST['name'] ?? '';
                $price = $_POST['price'] ?? 0;
                $short = $_POST['short_description'] ?? '';
                $long = $_POST['long_description'] ?? '';
                $categoryId = intval($_POST['category_id'] ?? 0);

                // 1. Insert sản phẩm cơ bản
                $stmt = $pdo->prepare("INSERT INTO products(name, price, short_description, long_description, category_id) VALUES (?,?,?,?,?)");
                $stmt->execute([$name, $price, $short, $long, $categoryId]);
                $productId = $pdo->lastInsertId();

                // 2. Xử lý ảnh upload
                if (!empty($_FILES['images'])) {
                    save_uploaded_images($pdo, $productId, $_FILES['images']);
                }

                // 3. Xử lý upload file sản phẩm duy nhất
                $files_json = null;
                if (isset($_FILES['file']) && $_FILES['file']['error'] === UPLOAD_ERR_OK) {
                    $uploadDir = __DIR__ . '/../uploads/files/';
                    if (!is_dir($uploadDir)) {
                        mkdir($uploadDir, 0777, true);
                    }
                    $ext = pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION);
                    $newName = 'prod' . uniqid() . '.' . $ext;
                    $targetPath = $uploadDir . $newName;

                    if (move_uploaded_file($_FILES['file']['tmp_name'], $targetPath)) {
                        $files_json = 'uploads/files/' . $newName;
                    }
                }

                // Nếu frontend gửi files_json thủ công
                if (isset($_POST['files_json']) && !$files_json) {
                    $files_json = $_POST['files_json'];
                }

                // 4. Nếu có files_json thì UPDATE thêm
                if ($files_json) {
                    $stmt = $pdo->prepare("UPDATE products SET files_json=? WHERE id=?");
                    $stmt->execute([$files_json, $productId]);
                }

                json_response(['success' => true, 'id' => $productId]);
            }

        // PUT - cập nhật sản phẩm
            if ($method === 'PUT' && count($parts) === 3) {
                $id = intval($parts[2]);
                if (!$id) json_response(['error' => 'id required'], 400);

                $name = $_POST['name'] ?? '';
                $price = $_POST['price'] ?? 0;
                $short = $_POST['short_description'] ?? '';
                $long = $_POST['long_description'] ?? '';
                $categoryId = intval($_POST['category_id'] ?? 0);

                $stmt = $pdo->prepare("UPDATE products 
                    SET name=?, price=?, short_description=?, long_description=?, category_id=? 
                    WHERE id=?");
                $stmt->execute([$name, $price, $short, $long, $categoryId, $id]);

                // xử lý ảnh
                $existingImages = json_decode($_POST['existingImages'] ?? "[]", true);
                $pdo->prepare("DELETE FROM product_images WHERE product_id=?")->execute([$id]);

                foreach ($existingImages as $img) {
                    $stmt = $pdo->prepare("INSERT INTO product_images(product_id,image_path,is_primary) VALUES (?,?,?)");
                    $stmt->execute([$id, $img['path'], $img['is_primary'] ?? 0]);
                }

                if (!empty($_FILES['images'])) {
                    save_uploaded_images($pdo, $id, $_FILES['images']);
                }

                json_response(['success' => true, 'id' => $id]);
            }

            // DELETE
        // DELETE
            if ($method === 'DELETE' && count($parts) === 3) {
                $id = intval($parts[2]);

                // 1. Lấy danh sách ảnh để xóa file vật lý
                $stmt = $pdo->prepare("SELECT image_path FROM product_images WHERE product_id=?");
                $stmt->execute([$id]);
                $images = $stmt->fetchAll(PDO::FETCH_ASSOC);

                foreach ($images as $img) {
                    $filePath = __DIR__ . '/../' . $img['image_path'];
                    if (file_exists($filePath)) {
                        @unlink($filePath);
                    }
                }

                // 2. Lấy file sản phẩm (files_json)
                $stmt = $pdo->prepare("SELECT files_json FROM products WHERE id=?");
                $stmt->execute([$id]);
                $fileRow = $stmt->fetch(PDO::FETCH_ASSOC);

                if ($fileRow && !empty($fileRow['files_json'])) {
                    $filePath = __DIR__ . '/../' . $fileRow['files_json'];
                    if (file_exists($filePath)) {
                        @unlink($filePath);
                    }
                }

                // 3. Xóa DB
                $pdo->prepare("DELETE FROM product_images WHERE product_id=?")->execute([$id]);
                $pdo->prepare("DELETE FROM products WHERE id=?")->execute([$id]);

                json_response(['success' => true]);
            }

        }

    }


    // ---------------- DOWNLOAD ----------------
    if($parts[0]==='download' && $method==='GET'){
        $token = $_GET['t'] ?? '';
        $cfg = get_config();
        $payload = verify_download_token($token,$cfg['download_token_secret']);
        if(!$payload){ http_response_code(403); echo 'Forbidden'; exit; }
        $file = $payload['file'];
        $full = realpath($file);
        $uploads = realpath($cfg['uploads_dir']);
        if(strpos($full,$uploads)!==0){ http_response_code(403); echo 'Forbidden'; exit; }
        if(!file_exists($full)){ http_response_code(404); echo 'Not found'; exit; }
        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="'.basename($full).'"');
        readfile($full); exit;
    }

        // ---------------- CATEGORIES ----------------
    if ($parts[0] === 'categories') {
        if ($method === 'GET') {
            $rows = $pdo->query('SELECT id, name FROM categories ORDER BY id ASC')
                        ->fetchAll(PDO::FETCH_ASSOC);
            json_response($rows);
        }
    }
    
    // ---------------- MOCK QR ----------------
    if($parts[0]==='mock-qrs'){
        header('Content-Type: image/png');
        echo base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=');
        exit;
    }

    json_response(['error'=>'Not found'],404);
    


} catch(Exception $e){
    json_response(['error'=>$e->getMessage()],500);
}

function save_uploaded_images($pdo, $productId, $files) {
    $uploadDir = __DIR__ . "/../uploads/images/";
    if (!is_dir($uploadDir)) {
        mkdir($uploadDir, 0777, true);
    }

    foreach ($files['tmp_name'] as $i => $tmpPath) {
        if (!is_uploaded_file($tmpPath)) continue;

        $originalName = $files['name'][$i];
        $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));

        // Đổi tên file: prod<ID>_<time>_<rand>.<ext>
        $newName = "prod{$productId}_" . time() . "_" . uniqid() . "." . $ext;
        $destPath = $uploadDir . $newName;

        if (move_uploaded_file($tmpPath, $destPath)) {
            // lấy is_primary từ POST, mặc định = 0
            $isPrimary = isset($_POST['is_primary'][$i]) ? intval($_POST['is_primary'][$i]) : 0;

            $stmt = $pdo->prepare("INSERT INTO product_images(product_id,image_path,is_primary) VALUES (?,?,?)");
            $stmt->execute([$productId, "uploads/images/$newName", $isPrimary]);
        }
    }
}