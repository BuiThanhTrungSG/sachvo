const payos = require("../utils/payos");
const crypto = require("crypto");

const createPayment = async (req, res) => {
  // dữ liệu body cho đơn hàng
  const body = {
    orderCode: Number(String(Date.now()).slice(-6)), // mã đơn hàng 6 số
    amount: parseInt(req.body.price),
    description: req.body.idproduct,
    returnUrl: ``,
    cancelUrl: ``,
  };

  try {
    // dùng API đúng của PayOS
    const paymentLinkResponse = await payos.paymentRequests.create(body);
    res.status(200).json(paymentLinkResponse);
  } catch (error) {
    res.status(500).send("Có lỗi xảy ra khi tạo link thanh toán");
  }
};
// bỏ đoạn này thử

// function verifySignature(req) {
//   const signature = req.headers["x-payos-signature"];
//   const body = JSON.stringify(req.body);
//   const secretKey = process.env.PAYOS_CLIENT_SECRET;

//   const hash = crypto
//     .createHmac("sha256", secretKey)
//     .update(body)
//     .digest("hex");

//   return hash === signature;
// }

const webhook = async (req, res) => {
  try {
    // if (!verifySignature(req)) {
    //   return res.status(400).send("Invalid signature");
    // }

    const payload = req.body;
    console.log("📩 Webhook nhận:", payload);

    if (payload.status === "PAID") {
      // 🔥 Gửi realtime tới frontend
      req.io.emit("payment_update", payload);
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).send("Webhook error");
  }
};

module.exports = {
  createPayment,
  webhook,
};
