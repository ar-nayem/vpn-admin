function createStorefrontAdminService({ db, orders, qr, proofStoragePath }) {
  const listStatement = db.prepare(`
    SELECT o.*, c.name AS customer_name, c.normalized_email AS customer_email,
      p.code_name, p.device_id
    FROM orders o JOIN customers c ON c.id=o.customer_id JOIN vpn_profiles p ON p.id=o.profile_id
    ORDER BY CASE o.state WHEN 'pending' THEN 0 WHEN 'provisioning_failed' THEN 1 ELSE 2 END, o.created_at DESC
  `);
  return {
    listOrders() { return listStatement.all(); },
    approveOrder(input) { return orders.approveOrder(input); },
    retryProvisioning(input) { return orders.retryProvisioning(input); },
    rejectOrder(input) { return orders.rejectOrder(input); },
    proofPath(orderId) {
      const row = db.prepare('SELECT proof_filename FROM orders WHERE id = ?').get(orderId);
      if (!row || !row.proof_filename || require('path').basename(row.proof_filename) !== row.proof_filename) return null;
      return { root: proofStoragePath, filename: row.proof_filename };
    },
    storeQrImage(method, file, adminRef) { return qr.storeQrImage(method, file, adminRef); },
    qrStatus() { return { wechat: qr.getActiveQr('wechat'), alipay: qr.getActiveQr('alipay') }; },
  };
}

module.exports = { createStorefrontAdminService };
