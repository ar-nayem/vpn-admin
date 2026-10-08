const test = require('node:test');
const assert = require('node:assert/strict');

const templates = require('../storefront/email/templates');
const { createEmailService } = require('../storefront/services/email');

test('branded templates escape content and include exact entitlement facts', () => {
  const message = templates.orderApprovedEmail({
    name: '<Buyer>', codeName: 'Phone & Tablet', planName: 'Basic', quotaGb: 180,
    speedLabel: '5 Mbps upload and download', expiresAt: '2027-01-08', downloadUrl: 'https://vpn.arnayem.top/download/token',
  });
  assert.match(message.subject, /VPN/i);
  assert.match(message.html, /#6D28D9|#6d28d9/);
  assert.match(message.html, /#FACC15|#facc15/);
  assert.doesNotMatch(message.html, /<Buyer>/);
  assert.match(message.html, /&lt;Buyer&gt;/);
  assert.match(message.html, /Phone &amp; Tablet/);
  for (const fact of ['Basic', '180 GB', '5 Mbps upload and download', '2027-01-08']) {
    assert.match(message.html, new RegExp(fact));
    assert.match(message.text, new RegExp(fact));
  }
});

test('verification and rejection templates include the required safe details', () => {
  assert.match(templates.verificationEmail({ code: '123456', purpose: 'login' }).html, /123456/);
  assert.match(templates.orderRejectedEmail({ name: 'Buyer', reason: 'Unreadable proof' }).text, /Unreadable proof/);
});

test('email sender uses branded content and a portable conf attachment', async () => {
  const sent = [];
  const service = createEmailService({
    transport: { async sendMail(message) { sent.push(message); return { messageId: 'mail-1' }; } },
    sender: 'nayem3622@gmail.com',
  });
  await service.send({
    recipient: 'buyer@example.com', template: 'order-approved',
    payload: { name: 'Buyer', codeName: 'Phone', planName: 'Premium', quotaGb: 120, speedLabel: 'Unlimited speed', expiresAt: '2026-11-08', downloadUrl: 'https://vpn.arnayem.top/d/x', config: 'secret config', filename: 'user22-d1.conf' },
  });
  assert.equal(sent[0].from, 'nayem3622@gmail.com');
  assert.deepEqual(sent[0].attachments[0], { filename: 'user22-d1.conf', content: 'secret config', contentType: 'text/plain' });
});
