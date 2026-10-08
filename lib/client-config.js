function buildClientConfiguration({ peer, privateKey, serverConfig, serverHost, deviceNumber = 1 }) {
  const content = `[Interface]\nPrivateKey = ${privateKey}\nAddress = ${peer.ip}/24\nDNS = 1.1.1.1, 8.8.8.8\nJc = ${serverConfig.jc}\nJmin = ${serverConfig.jmin}\nJmax = ${serverConfig.jmax}\nS1 = ${serverConfig.s1}\nS2 = ${serverConfig.s2}\nH1 = ${serverConfig.h1}\nH2 = ${serverConfig.h2}\nH3 = ${serverConfig.h3}\nH4 = ${serverConfig.h4}\n\n[Peer]\nPublicKey = ${serverConfig.pubkey}\nEndpoint = ${serverHost}:${serverConfig.endpointPort}\nAllowedIPs = 0.0.0.0/0\nPersistentKeepalive = 25\n`;
  const baseName = Number.isInteger(peer.userNumber)
    ? `user${peer.userNumber}-d${deviceNumber}`
    : String(peer.name || 'vpn').replace(/[^a-zA-Z0-9_.-]/g, '_');
  return { filename: `${baseName}.conf`, content };
}

module.exports = { buildClientConfiguration };
