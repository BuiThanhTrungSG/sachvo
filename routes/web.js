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

module.exports = router;
