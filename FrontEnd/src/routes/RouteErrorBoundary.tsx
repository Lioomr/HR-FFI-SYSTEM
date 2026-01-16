import { Button, Card, Result, Space, Typography } from "antd";
import { useNavigate, useRouteError } from "react-router-dom";

export default function RouteErrorBoundary() {
  const err = useRouteError() as any;
  const navigate = useNavigate();

  const title = "Something went wrong";
  const subtitle =
    err?.statusText ||
    err?.message ||
    "An unexpected error occurred while rendering this page.";

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <Card style={{ width: "100%", maxWidth: 720, borderRadius: 16 }}>
        <Result
          status="error"
          title={title}
          subTitle={subtitle}
          extra={
            <Space>
              <Button type="primary" onClick={() => window.location.reload()}>
                Reload
              </Button>
              <Button onClick={() => navigate("/login")}>Go to Login</Button>
              <Button onClick={() => navigate(-1)}>Back</Button>
            </Space>
          }
        />
        {err ? (
          <div style={{ marginTop: 8 }}>
            <Typography.Text type="secondary">
              Details (for debugging):
            </Typography.Text>
            <pre
              style={{
                marginTop: 8,
                padding: 12,
                borderRadius: 12,
                background: "rgba(0,0,0,0.04)",
                overflow: "auto",
              }}
            >
              {String(err?.stack || err)}
            </pre>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
