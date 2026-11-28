require("dotenv").config();

const app = require("./app");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`UPerfumes server escuchando en http://localhost:${PORT}`);
  console.log(`Ambiente Webpay: ${process.env.TRANSBANK_ENVIRONMENT || "integration"}`);
});

if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
  const admin = require('express')();
  admin.disable('x-powered-by');
  admin.use(require('./routes/adminStock'));
  admin.listen(3001, '127.0.0.1', () => {
    console.log('Panel privado: http://127.0.0.1:3001/admin-stock');
  }).on('error', error => console.error('Panel local desactivado:', error.message));
}
