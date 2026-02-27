const fs = require('fs');
let code = fs.readFileSync('D:\\HR-FFI-SYSTEM\\FrontEnd\\src\\pages\\admin\\AdminDashboardPage.tsx', 'utf8');

code = code.replace(
    /title: t\("admin.dashboard.action"\), dataIndex: 'action', key: 'action', render: \(t\) => \(\s*<span style=\{\{ fontWeight: 500 \}\}>\{t\}<\/span>/,
    `title: t("admin.dashboard.action"), dataIndex: 'action', key: 'action', render: (val) => (\n                    <span style={{ fontWeight: 500 }}>{t(\`audit.action.\${val}\`, val)}</span>`
);

code = code.replace(
    /<span>\{item\.action\}<\/span>/g,
    `<span>{t(\`audit.action.\${item.action}\`, item.action)}</span>`
);

fs.writeFileSync('D:\\HR-FFI-SYSTEM\\FrontEnd\\src\\pages\\admin\\AdminDashboardPage.tsx', code);
