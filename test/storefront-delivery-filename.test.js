const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDeliveryFilename } = require('../storefront/services/delivery-filename');

test('uses the customer name and device code name', () => {
  assert.equal(buildDeliveryFilename({ name: 'Nayem Ahmed', email: 'x@example.com', codeName: 'iPhone', profileId: 'abc' }), 'Nayem-Ahmed-iPhone.conf');
});

test('falls back to the email local part when the name is empty', () => {
  assert.equal(buildDeliveryFilename({ name: '', email: '15329802848@163.com', codeName: 'Phone', profileId: 'abc' }), '15329802848-Phone.conf');
});

test('removes path characters and leading dots', () => {
  assert.equal(buildDeliveryFilename({ name: '../Nayem', email: 'x@example.com', codeName: '/Phone', profileId: 'abc' }), 'Nayem-Phone.conf');
});

test('falls back to the first eight profile ID characters when no usable labels remain', () => {
  assert.match(buildDeliveryFilename({ name: '....', email: '...@example.com', codeName: '...', profileId: 'abcdef1234' }), /^vpn-abcdef12\.conf$/);
});

test('preserves Unicode letters and numbers while collapsing punctuation and whitespace', () => {
  assert.equal(buildDeliveryFilename({ name: ' 张三  !! Ahmed ', email: '', codeName: '设备 ２—Phone', profileId: 'abc' }), '张三-Ahmed-设备-２-Phone.conf');
});

test('removes control characters and appends the configuration extension exactly once', () => {
  assert.equal(buildDeliveryFilename({ name: 'Na\u0000yem\nAhmed', email: '', codeName: '\\Phone.conf.conf', profileId: 'abc' }), 'NayemAhmed-Phone.conf');
});

test('caps the basename at 96 Unicode characters without splitting a letter', () => {
  const filename = buildDeliveryFilename({ name: '𐐀'.repeat(100), email: '', codeName: 'Phone', profileId: 'abc' });
  assert.equal(filename, `${'𐐀'.repeat(90)}-Phone.conf`);
});

test('reserves device identity when long real names or email labels exhaust the basename budget', () => {
  for (const labels of [{ name: 'Customer'.repeat(30), email: '' }, { name: '', email: `${'email'.repeat(50)}@example.com` }]) {
    const phone = buildDeliveryFilename({ ...labels, codeName: 'Personal iPhone', profileId: 'one' });
    const tablet = buildDeliveryFilename({ ...labels, codeName: 'Personal iPad', profileId: 'two' });
    assert.ok(Array.from(phone.slice(0, -5)).length <= 96);
    assert.ok(Array.from(tablet.slice(0, -5)).length <= 96);
    assert.match(phone, /-Personal-iPhone\.conf$/);
    assert.match(tablet, /-Personal-iPad\.conf$/);
    assert.notEqual(phone, tablet);
  }
});
