const test = require('node:test');
const assert = require('node:assert/strict');

const { createAdapter } = require('../lib/awg');

function recordingExecutor(responses = new Map()) {
  const calls = [];
  const execFileSync = (command, args, options = {}) => {
    calls.push({ command, args, options });
    const key = `${command} ${args.join(' ')}`;
    return Buffer.from(responses.get(key) || '');
  };
  return { calls, execFileSync };
}

test('targeted peer changes use argument arrays and never awg-quick', () => {
  const recorder = recordingExecutor();
  const adapter = createAdapter({ execFileSync: recorder.execFileSync, iface: 'awg0' });

  adapter.addPeer('public-key', '10.66.67.23');
  adapter.removePeer('public-key');

  assert.deepEqual(recorder.calls.map(({ command, args }) => [command, args]), [
    ['awg', ['set', 'awg0', 'peer', 'public-key', 'allowed-ips', '10.66.67.23/32']],
    ['awg', ['set', 'awg0', 'peer', 'public-key', 'remove']],
  ]);
  assert.equal(recorder.calls.some(({ command }) => command.includes('awg-quick')), false);
});

test('key generation pipes the generated private key to awg pubkey', () => {
  const responses = new Map([
    ['awg genkey', 'private-key\n'],
    ['awg pubkey', 'public-key\n'],
  ]);
  const recorder = recordingExecutor(responses);
  const adapter = createAdapter({ execFileSync: recorder.execFileSync });

  const pair = adapter.generateKeyPair();

  assert.deepEqual(pair, { privateKey: 'private-key', publicKey: 'public-key' });
  assert.equal(recorder.calls[1].options.input, 'private-key\n');
});
