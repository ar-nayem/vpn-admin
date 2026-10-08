const nodemailer = require('nodemailer');
const crypto = require('crypto');
const templates = require('../email/templates');
const { encryptJson, decryptJson } = require('../crypto');

const TEMPLATE_MAP = {
  'verification-code': templates.verificationEmail,
  'password-recovery': templates.passwordRecoveryEmail,
  'order-received': templates.orderReceivedEmail,
  'trial-activated': templates.trialActivatedEmail,
  'order-approved': templates.orderApprovedEmail,
  'order-rejected': templates.orderRejectedEmail,
};

function createEmailService({ transport, gmailAppPassword, sender = 'nayem3622@gmail.com' }) {
  const mailer = transport || nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: sender, pass: gmailAppPassword },
  });
  return {
    async send({ recipient, template, payload }) {
      const render = TEMPLATE_MAP[template];
      if (!render) throw new TypeError('email template is invalid');
      const message = render(payload);
      const attachments = payload.config ? [{ filename: payload.filename, content: payload.config, contentType: 'text/plain' }] : undefined;
      return mailer.sendMail({ from: sender, to: recipient, subject: message.subject, html: message.html, text: message.text, attachments });
    },
  };
}

function createOutboxProcessor({ outbox, email, outboxKey, now = () => new Date() }) {
  return {
    async processOutboxBatch({ limit = 20 } = {}) {
      const claimed = outbox.claimBatch({ limit, timestamp: now().toISOString() });
      const results = [];
      for (const message of claimed) {
        try {
          await email.send({ recipient: message.recipient, template: message.template, payload: decryptJson(message.encrypted_payload, outboxKey) });
          outbox.markSent(message.id, now().toISOString());
          results.push({ id: message.id, state: 'sent' });
        } catch {
          outbox.markFailedAttempt(message.id, now());
          results.push({ id: message.id, state: 'retry' });
        }
      }
      return results;
    },
  };
}

function createNotificationService({
  outbox, outboxKey, downloads, provisioning, publicBaseUrl = 'https://vpn.arnayem.top',
  now = () => new Date(), randomUUID = crypto.randomUUID, randomBytes = crypto.randomBytes,
}) {
  function enqueue(template, recipient, payload) {
    const timestamp = now().toISOString();
    outbox.enqueue({
      id: randomUUID(), template, recipient,
      encryptedPayload: encryptJson(payload, outboxKey, randomBytes),
      availableAt: timestamp, createdAt: timestamp,
    });
  }
  async function configurationPayload(profile) {
    const config = await provisioning.getConfiguration(profile.device_id);
    const download = downloads.createDownloadToken({ profileId: profile.id, configContent: config.content, filename: config.filename });
    return { config: config.content, filename: config.filename, downloadUrl: `${publicBaseUrl}/download/${download.token}` };
  }
  const speedLabel = (profile) => profile.down_kbps || profile.up_kbps
    ? `${Math.max(profile.down_kbps, profile.up_kbps) / 1024} Mbps upload and download`
    : 'Unlimited speed';
  return {
    async trialActivated({ customer, profile }) {
      enqueue('trial-activated', customer.normalized_email, {
        name: customer.name, codeName: profile.code_name, ...(await configurationPayload(profile)),
      });
    },
    orderReceived({ order, profile }) {
      enqueue('order-received', profile.customer_email, {
        name: profile.customer_name, planName: order.plan_name, months: order.months, priceCny: order.price_cny,
      });
    },
    async orderApproved({ order, profile }) {
      enqueue('order-approved', profile.customer_email, {
        name: profile.customer_name, codeName: profile.code_name, planName: profile.plan_name,
        quotaGb: profile.quota_bytes / (1024 ** 3), speedLabel: speedLabel(profile),
        expiresAt: profile.expires_at, ...(await configurationPayload(profile)),
      });
    },
    orderRejected({ order, profile }) {
      enqueue('order-rejected', profile.customer_email, { name: profile.customer_name, reason: order.rejection_reason });
    },
  };
}

module.exports = { createEmailService, createOutboxProcessor, createNotificationService };
