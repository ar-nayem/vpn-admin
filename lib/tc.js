const { execSync } = require('child_process');

const IFACE = 'awg0';
const IFB = 'ifb0';
const LINK_MBIT = 1000;

function run(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  } catch (err) {
    return null;
  }
}

function octetOf(ip) {
  return parseInt(ip.split('.')[3], 10);
}

function ensureRootQdisc() {
  if (!run(`tc qdisc show dev ${IFACE}`).includes('htb 1:')) {
    run(`tc qdisc add dev ${IFACE} root handle 1: htb default 999`);
    run(`tc class add dev ${IFACE} parent 1: classid 1:999 htb rate ${LINK_MBIT}mbit ceil ${LINK_MBIT}mbit`);
  }

  if (!run(`ip link show ${IFB}`)) {
    run(`ip link add ${IFB} type ifb`);
  }
  run(`ip link set ${IFB} up`);

  const ingress = run(`tc qdisc show dev ${IFACE}`) || '';
  if (!ingress.includes('ingress')) {
    run(`tc qdisc add dev ${IFACE} ingress`);
    run(`tc filter add dev ${IFACE} parent ffff: matchall action mirred egress redirect dev ${IFB}`);
  }

  if (!run(`tc qdisc show dev ${IFB}`).includes('htb 1:')) {
    run(`tc qdisc add dev ${IFB} root handle 1: htb default 999`);
    run(`tc class add dev ${IFB} parent 1: classid 1:999 htb rate ${LINK_MBIT}mbit ceil ${LINK_MBIT}mbit`);
  }
}

function applyDirectionLimit(dev, ip, kbps, matchDir) {
  const id = octetOf(ip);
  run(`tc filter del dev ${dev} parent 1: prio ${id} 2>/dev/null`);
  run(`tc class del dev ${dev} parent 1: classid 1:${id} 2>/dev/null`);
  if (kbps && kbps > 0) {
    run(`tc class add dev ${dev} parent 1: classid 1:${id} htb rate ${kbps}kbit ceil ${kbps}kbit`);
    run(`tc qdisc add dev ${dev} parent 1:${id} handle ${id}: sfq perturb 10`);
    run(`tc filter add dev ${dev} parent 1: protocol ip prio ${id} u32 match ip ${matchDir} ${ip}/32 flowid 1:${id}`);
  }
}

function setPeerLimit(ip, downKbps, upKbps) {
  ensureRootQdisc();
  applyDirectionLimit(IFACE, ip, downKbps, 'dst');
  applyDirectionLimit(IFB, ip, upKbps, 'src');
}

function clearPeerLimit(ip) {
  applyDirectionLimit(IFACE, ip, 0, 'dst');
  applyDirectionLimit(IFB, ip, 0, 'src');
}

module.exports = { ensureRootQdisc, setPeerLimit, clearPeerLimit };
