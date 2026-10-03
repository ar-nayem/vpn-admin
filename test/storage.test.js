const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createStore } = require('../lib/store');
const { createKeyStore } = require('../lib/keys');

function tempFile(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vpn-admin-storage-'));
  return { directory, file: path.join(directory, name) };
}

test('peer store atomically replaces complete JSON state', (t) => {
  const { directory, file } = tempFile('peers.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(file);

  store.save([{ name: 'before' }]);
  store.save([{ name: 'after' }, { name: 'second' }]);

  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [
    { name: 'after' },
    { name: 'second' },
  ]);
  assert.deepEqual(fs.readdirSync(directory), ['peers.json']);
});

test('private key store writes mode 0600 and deletes only one key', (t) => {
  const { directory, file } = tempFile('private-keys.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const keyStore = createKeyStore(file);

  keyStore.replace({ one: 'private-one', two: 'private-two' });
  keyStore.deletePrivateKey('one');

  assert.deepEqual(keyStore.load(), { two: 'private-two' });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(directory), ['private-keys.json']);
});

test('key store returns null for unknown keys', (t) => {
  const { directory, file } = tempFile('private-keys.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  assert.equal(createKeyStore(file).getPrivateKey('missing'), null);
});
