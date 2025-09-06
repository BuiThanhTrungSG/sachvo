const payos = require("../utils/payos");
const clients = []; // lưu danh sách client đang kết nối

const createPayment = async (req, res) => {
  const body = {
    orderCode: Number(String(Date.now()).slice(-6)), // mã đơn hàng 6 số
    amount: parseInt(req.body.price),
    description: req.body.idproduct,
    returnUrl: ``,
    cancelUrl: ``,
  };

  try {
    const paymentLinkResponse = await payos.paymentRequests.create(body);
    res.status(200).json(paymentLinkResponse);
  } catch (error) {
    console.error("❌ Lỗi tạo link:", error);
    res.status(500).send("Có lỗi xảy ra khi tạo link thanh toán");
  }
};

// Webhook PayOS gọi tới
const webhook = async (req, res) => {
  try {
    const payload = req.body;

    const status = payload.data?.desc;

    console.log("📩 Webhook nhận:", payload.data);

    console.log("📩 Webhook nhận 2:", status);

    if (status === "success") {
      sendToClients("payment_update", payload.data);
    }
    res.status(200).send("OK");
  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.status(500).send("Webhook error");
  }
};

// Endpoint SSE
const paymentStream = (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders(); // gửi header ngay

  // thông báo kết nối thành công
  res.write("event: connected\n");
  res.write(`data: "SSE connected"\n\n`);

  clients.push(res);

  // gửi ping định kỳ giữ kết nối
  const interval = setInterval(() => {
    res.write("event: ping\n");
    res.write(`data: ${Date.now()}\n\n`);
  }, 15000);

  // khi client đóng kết nối
  req.on("close", () => {
    clearInterval(interval);
    const i = clients.indexOf(res);
    if (i !== -1) clients.splice(i, 1);
    console.log("❌ Client SSE ngắt kết nối");
  });
};

// broadcast tới tất cả client
const sendToClients = (event, data) => {
  const msg = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach((client) => client.write(msg));
};

module.exports = {
  createPayment,
  webhook,
  paymentStream,
};
