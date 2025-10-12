const express = require("express");
const { products, fetchProductById } = require("../controllers/homeController");
const {
  createPayment,
  webhook,
  paymentStream,
} = require("../controllers/payments");
const {
  adminLogin,
  categories,
  adminProducts,
  adminDelete,
  adminCreateProduct,
} = require("../controllers/adminController");

const cuocthiController = require("../controllers/cuocthiController");
const createExam = require("../controllers/exams");

const router = express.Router();
const multer = require("multer");
const path = require("path");
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === "file") {
      // file chính
      cb(null, "uploads/files/");
    } else if (file.fieldname === "images") {
      // ảnh sản phẩm
      cb(null, "uploads/images/");
    } else {
      cb(null, "uploads/"); // fallback
    }
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// =============================================================
// BỔ SUNG: Cấu hình multer riêng cho cuocthi
const cuocthiStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Tất cả ảnh của cuộc thi đều vào thư mục này
    cb(null, "uploads/cuocthi/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const cuocthiUpload = multer({ storage: cuocthiStorage });
// =============================================================

// PAYMENT
router.post("/create-payment", createPayment);
router.post("/webhook", webhook);
router.get("/paymentStream", paymentStream);
// PRODUCTS
router.get("/products", products);
router.get("/products/:id", fetchProductById);
router.get("/categories", categories);

// ADMIN
router.get("/adminproducts", adminProducts);
router.post("/login", adminLogin);
router.delete("/adminDelete/:id", adminDelete);

router.post(
  "/createProduct",
  upload.fields([
    { name: "file", maxCount: 1 }, // trùng với form.file
    { name: "images", maxCount: 20 }, // trùng với form.images
  ]),
  adminCreateProduct
);

// API sinh đề
router.post("/exams", createExam);

// API CUOC THI

// CREAT CUOCTHI
router.post(
  "/cuocthi",
  cuocthiUpload.single("image"),
  cuocthiController.createCuocthi
);

// READ LIST
router.get("/cuocthi", cuocthiController.getCuocthiList);

// READ DETAIL
router.get("/cuocthi/:id", cuocthiController.getCuocthiById);

// UPDATE - Gắn middleware upload ảnh
router.put(
  "/cuocthi/:id",
  cuocthiUpload.single("image"),
  cuocthiController.updateCuocthi
);

// DELETE
router.delete("/cuocthi/:id", cuocthiController.deleteCuocthi);
// =============================================================

// VAO THI
router.get("/vaothi/:id", cuocthiController.getVaoThi);

// NOP BAI THI
router.post("/nopbai", cuocthiController.postNopBaiThi);

// BANG XEP HANG
router.get("/xephang/:id", cuocthiController.getBangXepHangById);

module.exports = router;
