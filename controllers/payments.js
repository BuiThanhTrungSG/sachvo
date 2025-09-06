const payos = require("../utils/payos");
const clients = []; // lưu danh sách client đang kết nối

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
    const payload = req.body;
    console.log("📩 Webhook nhận:", payload);

    const status = payload.data?.status;

    if (status === "PAID") {
      sendToClients(payload.data);
    } else if (status === "FAILED" || status === "CANCELED") {
      sendToClients(payload.data);
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).send("Webhook error");
  }
};

// Endpoint SSE
const paymentStream = (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // push client vào list
  clients.push(res);

  // khi client đóng connection thì xoá đi
  req.on("close", () => {
    const index = clients.indexOf(res);
    if (index !== -1) clients.splice(index, 1);
  });
};

// gửi broadcast tới tất cả client
const sendToClients = (data) => {
  clients.forEach((client) => {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  });
};

module.exports = {
  createPayment,
  webhook,
  paymentStream,
};
