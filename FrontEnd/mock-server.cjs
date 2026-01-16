const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "mock-backend" });
});

app.post("/auth/login", (req, res) => {
  const { email } = req.body || {};
  const e = String(email || "").toLowerCase();

  let role = "Employee";
  if (e.includes("admin")) role = "SystemAdmin";
  else if (e.includes("hr")) role = "HRManager";

  res.json({
    status: "success",
    data: {
      token: "mock-token-123",
      user: { id: "1", email, role },
    },
  });
});

app.post("/auth/logout", (req, res) => {
  res.json({ status: "success", data: {} });
});

app.post("/auth/change-password", (req, res) => {
  res.json({ status: "success", data: {} });
});

app.listen(5000, () => console.log("Mock backend running on http://localhost:5000"));
