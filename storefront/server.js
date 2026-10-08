const path = require('path');
const { loadConfig } = require('./config');
const { openDatabase } = require('./db/database');
const { createCustomerRepository } = require('./repositories/customers');
const { createChallengeRepository } = require('./repositories/challenges');
const { createOutboxRepository } = require('./repositories/outbox');
const { createProfileRepository } = require('./repositories/profiles');
const { createOrderRepository } = require('./repositories/orders');
const { createSettingsRepository } = require('./repositories/settings');
const { createDownloadTokenRepository } = require('./repositories/download-tokens');
const { createVerificationService } = require('./services/verification');
const { createAuthService } = require('./services/auth');
const { createProvisioningClient } = require('./services/provisioning-client');
const { createTrialService } = require('./services/trials');
const { createTrackingService } = require('./services/tracking');
const { createOrderService, createQrService } = require('./services/orders');
const { createDownloadService } = require('./services/downloads');
const { createNotificationService } = require('./services/email');
const { createPrivateImageStore, createImageUpload } = require('./middleware/uploads');
const { createStorefrontApp } = require('./app');

function start() {
  const config = loadConfig();
  const db = openDatabase(config.databasePath);
  const customers = createCustomerRepository(db);
  const challenges = createChallengeRepository(db);
  const outbox = createOutboxRepository(db);
  const profiles = createProfileRepository(db);
  const ordersRepo = createOrderRepository(db);
  const settings = createSettingsRepository(db);
  const verification = createVerificationService({ challenges, outbox, otpPepper: config.otpPepper, outboxKey: config.outboxKey });
  const provisioning = createProvisioningClient({ secret: config.internalSecret });
  const downloads = createDownloadService({ db, tokens: createDownloadTokenRepository(db), downloadKey: config.downloadKey });
  const notifications = createNotificationService({ outbox, outboxKey: config.outboxKey, downloads, provisioning });
  const proofStorage = createPrivateImageStore({ storageDir: path.join(config.storagePath, 'proofs') });
  const qrStorage = createPrivateImageStore({ storageDir: path.join(config.storagePath, 'qr') });
  const services = {
    verification,
    auth: createAuthService({ db, customers, verification }),
    trials: createTrialService({ db, customers, profiles, verification, provisioning, notifications }),
    tracking: createTrackingService({ profiles, verification, provisioning }),
    orders: createOrderService({ db, orders: ordersRepo, profiles, verification, proofStorage, provisioning, notifications }),
    qr: createQrService({ db, settings, storage: qrStorage }),
    qrStoragePath: path.join(config.storagePath, 'qr'),
    downloads,
  };
  const app = createStorefrontApp({ db, sessionSecret: config.sessionSecret, production: config.production, services, uploadProof: createImageUpload('proof') });
  return app.listen(config.port, config.host, () => console.log(`Storefront listening on http://${config.host}:${config.port}`));
}

if (require.main === module) start();
module.exports = { start };
